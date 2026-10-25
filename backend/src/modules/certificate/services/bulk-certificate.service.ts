import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { parseCsv } from '../../../common/utils/csv-parser.util';
import { MetadataSchemaService } from '../../metadata-schema/services/metadata-schema.service';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { defaultDuplicateDetectionConfig } from '../config/duplicate-detection.config';
import { IssueCertificateDto } from '../dto/issue-certificate.dto';
import {
  BulkIssuePreviewDto,
  BulkIssueDryRunResponseDto,
  BulkIssueRowPreview,
} from '../dto/bulk-issue-certificate.dto';
import {
  BULK_CERTIFICATE_QUEUE_NAME,
  BulkJobType,
  BulkIssuanceJobData,
} from '../processors/bulk-certificate.processor';

@Injectable()
export class BulkCertificateService {
  private readonly logger = new Logger(BulkCertificateService.name);

  constructor(
    @InjectQueue(BULK_CERTIFICATE_QUEUE_NAME)
    private readonly bulkQueue: Queue,
    private readonly metadataSchemaService: MetadataSchemaService,
    private readonly duplicateDetectionService: DuplicateDetectionService,
  ) {}

  async processCsvBulk(
    csvBuffer: Buffer | string,
    dto: BulkIssuePreviewDto,
    issuerId: string,
  ): Promise<BulkIssueDryRunResponseDto> {
    const csvContent = Buffer.isBuffer(csvBuffer)
      ? csvBuffer.toString('utf-8')
      : csvBuffer;

    const rawRows = parseCsv(csvContent);
    if (!rawRows || rawRows.length === 0) {
      throw new BadRequestException('The uploaded CSV file is empty or contains no data rows');
    }

    let schema: any = null;
    if (dto.metadataSchemaId) {
      schema = await this.metadataSchemaService.findOne(dto.metadataSchemaId);
      if (!schema) {
        throw new NotFoundException(`Metadata schema with ID ${dto.metadataSchemaId} not found`);
      }
    }

    const rowPreviews: BulkIssueRowPreview[] = [];
    const validIssuanceRows: Array<{ dto: IssueCertificateDto; overrideReason?: string }> = [];

    let duplicateHits = 0;
    let blockedRows = 0;
    let warningRows = 0;

    for (let index = 0; index < rawRows.length; index++) {
      const raw = rawRows[index];
      const errors: string[] = [];

      // Extract core fields (case-insensitive key mapping if needed)
      const recipientEmail = (raw.recipientEmail || raw.email || raw['Recipient Email'] || '').trim();
      const recipientName = (raw.recipientName || raw.name || raw['Recipient Name'] || '').trim();
      const title = (raw.title || raw['Certificate Title'] || raw['Title'] || '').trim();
      const description = (raw.description || raw['Description'] || '').trim();
      const courseName = (raw.courseName || raw['Course Name'] || raw['Course'] || '').trim();
      const expiresAt = (raw.expiresAt || raw['Expires At'] || raw['Expiry Date'] || '').trim();
      const recipientStellarAddress = (raw.recipientStellarAddress || raw['Recipient Stellar Address'] || '').trim();

      if (!recipientEmail) {
        errors.push('recipientEmail is required');
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
        errors.push('recipientEmail must be a valid email address');
      }

      if (!recipientName) {
        errors.push('recipientName is required');
      }

      if (!title) {
        errors.push('title is required');
      }

      if (expiresAt) {
        const parsedDate = new Date(expiresAt);
        if (isNaN(parsedDate.getTime())) {
          errors.push('expiresAt must be a valid date');
        } else if (parsedDate.getTime() <= Date.now()) {
          errors.push('expiresAt must be a date in the future');
        }
      }

      // Collect schema metadata
      let metadata: Record<string, any> = {};
      if (schema) {
        for (const field of schema.fields || []) {
          const val = raw[field.name];
          if (val !== undefined && val !== '') {
            if (field.type === 'number') {
              metadata[field.name] = Number(val);
            } else if (field.type === 'boolean') {
              metadata[field.name] = val.toLowerCase() === 'true' || val === '1';
            } else {
              metadata[field.name] = val;
            }
          }
        }

        // Validate metadata against schema
        const schemaValidation = this.metadataSchemaService.validateAgainstSchema(schema, metadata);
        if (schemaValidation && schemaValidation.length > 0) {
          for (const err of schemaValidation) {
            errors.push(`Metadata field "${err.field}": ${err.message}`);
          }
        }
      }

      // Build target DTO
      const issueDto: IssueCertificateDto = {
        issuerId,
        recipientEmail,
        recipientName,
        title,
        ...(description && { description }),
        ...(courseName && { courseName }),
        ...(expiresAt && { expiresAt: new Date(expiresAt).toISOString() }),
        ...(recipientStellarAddress && { recipientStellarAddress }),
        ...(dto.templateId && { templateId: dto.templateId }),
        ...(dto.metadataSchemaId && { metadataSchemaId: dto.metadataSchemaId }),
        ...(Object.keys(metadata).length > 0 && { metadata }),
      };

      // Check duplicates
      let duplicateResult: any = undefined;
      let isBlockedByDuplicate = false;
      try {
        const dupCheck = await this.duplicateDetectionService.checkForDuplicates(
          issueDto as any,
          defaultDuplicateDetectionConfig,
        );
        if (dupCheck.isDuplicate) {
          duplicateHits++;
          if (dupCheck.action === 'block') {
            blockedRows++;
            isBlockedByDuplicate = true;
            errors.push('Certificate duplicate detection rule blocked this row');
          } else if (dupCheck.action === 'warn') {
            warningRows++;
            if (!dto.overrideReason) {
              errors.push('Certificate duplicate warning: override reason required');
            }
          }
        }

        duplicateResult = {
          isDuplicate: dupCheck.isDuplicate,
          action: dupCheck.action,
          confidence: dupCheck.confidence,
          matches: dupCheck.matches.map((m) => ({
            certificateId: m.certificateId,
            similarityScore: m.similarityScore,
            matchType: m.matchType,
            title: m.title,
            recipientEmail: m.recipientEmail,
          })),
          message: dupCheck.message,
        };
      } catch (dupErr) {
        this.logger.warn(`Duplicate check error on row ${index + 1}: ${dupErr.message}`);
      }

      const isValid = errors.length === 0;

      rowPreviews.push({
        rowIndex: index + 1,
        recipientEmail,
        recipientName,
        title,
        isValid,
        validationErrors: errors,
        duplicateCheck: duplicateResult,
      });

      if (isValid) {
        validIssuanceRows.push({
          dto: issueDto,
          overrideReason: dto.overrideReason,
        });
      }
    }

    const totalRows = rowPreviews.length;
    const validRows = validIssuanceRows.length;
    const invalidRows = totalRows - validRows;
    const canQueue = validRows > 0;

    let queuedJobId: string | undefined = undefined;

    // Queue issuance job as Bull job if there are valid rows
    if (canQueue) {
      const jobData: BulkIssuanceJobData = {
        issuerId,
        rows: validIssuanceRows,
      };

      const job = await this.bulkQueue.add(BulkJobType.PROCESS_BULK_ISSUANCE, jobData, {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: false,
      });

      queuedJobId = String(job.id);
      this.logger.log(`Queued bulk issuance job ${job.id} for ${validRows} certificates`);
    }

    return {
      totalRows,
      validRows,
      invalidRows,
      duplicateHits,
      blockedRows,
      warningRows,
      schemaId: schema?.id,
      schemaVersion: schema?.version,
      rows: rowPreviews,
      jobId: queuedJobId,
      canQueue,
    };
  }
}
