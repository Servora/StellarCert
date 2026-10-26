import { BulkCertificateService } from './bulk-certificate.service';
import { BulkJobType } from '../processors/bulk-certificate.processor';
import { BadRequestException } from '@nestjs/common';

describe('BulkCertificateService', () => {
  let service: BulkCertificateService;
  let mockQueue: any;
  let mockMetadataSchemaService: any;
  let mockDuplicateDetectionService: any;

  beforeEach(() => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-999' }),
    };
    mockMetadataSchemaService = {
      findOne: jest.fn(),
      validateAgainstSchema: jest.fn().mockReturnValue([]),
    };
    mockDuplicateDetectionService = {
      checkForDuplicates: jest.fn().mockResolvedValue({
        isDuplicate: false,
        confidence: 0,
        matches: [],
        action: 'allow',
      }),
    };

    service = new BulkCertificateService(
      mockQueue,
      mockMetadataSchemaService,
      mockDuplicateDetectionService,
    );
  });

  it('throws BadRequestException if CSV is empty', async () => {
    await expect(service.processCsvBulk('', {}, 'issuer-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('validates rows, returns dry-run report, and queues a Bull job when valid', async () => {
    const csv = [
      'recipientEmail,recipientName,title,courseName,expiresAt',
      'student1@example.com,John Doe,Web Dev Certificate,Full Stack,2028-01-01',
      'student2@example.com,Jane Smith,Data Science,AI Course,2029-01-01',
    ].join('\n');

    const result = await service.processCsvBulk(
      Buffer.from(csv),
      { templateId: 'template-uuid-1' },
      'issuer-uuid-1',
    );

    expect(result.totalRows).toBe(2);
    expect(result.validRows).toBe(2);
    expect(result.invalidRows).toBe(0);
    expect(result.duplicateHits).toBe(0);
    expect(result.blockedRows).toBe(0);
    expect(result.canQueue).toBe(true);
    expect(result.jobId).toBe('job-999');

    expect(mockQueue.add).toHaveBeenCalledWith(
      BulkJobType.PROCESS_BULK_ISSUANCE,
      expect.objectContaining({
        issuerId: 'issuer-uuid-1',
        rows: expect.arrayContaining([
          expect.objectContaining({
            dto: expect.objectContaining({
              recipientEmail: 'student1@example.com',
              recipientName: 'John Doe',
              title: 'Web Dev Certificate',
            }),
          }),
        ]),
      }),
      expect.any(Object),
    );
  });

  it('validates rows against metadata schema and flags schema errors', async () => {
    const csv = [
      'recipientEmail,recipientName,title,grade,skills',
      'student1@example.com,John Doe,Web Dev,A,React',
    ].join('\n');

    mockMetadataSchemaService.findOne.mockResolvedValue({
      id: 'schema-123',
      version: '1.0.0',
      fields: [
        { name: 'grade', type: 'string' },
        { name: 'skills', type: 'string' },
      ],
    });

    mockMetadataSchemaService.validateAgainstSchema.mockReturnValue([
      { field: 'grade', message: '"grade" must match pattern ^[A-F]$' },
    ]);

    const result = await service.processCsvBulk(
      csv,
      { metadataSchemaId: 'schema-123' },
      'issuer-1',
    );

    expect(result.totalRows).toBe(1);
    expect(result.validRows).toBe(0);
    expect(result.invalidRows).toBe(1);
    expect(result.rows[0].isValid).toBe(false);
    expect(result.rows[0].validationErrors[0]).toContain(
      'Metadata field "grade"',
    );
    expect(result.canQueue).toBe(false);
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('detects duplicate certificates and blocks rows according to duplicate rules', async () => {
    const csv = [
      'recipientEmail,recipientName,title',
      'student1@example.com,John Doe,Web Dev Certificate',
    ].join('\n');

    mockDuplicateDetectionService.checkForDuplicates.mockResolvedValue({
      isDuplicate: true,
      confidence: 1.0,
      action: 'block',
      matches: [
        {
          certificateId: 'existing-cert-1',
          similarityScore: 1.0,
          matchType: 'exact',
          title: 'Web Dev Certificate',
          recipientEmail: 'student1@example.com',
        },
      ],
      message: 'Exact duplicate match',
    });

    const result = await service.processCsvBulk(csv, {}, 'issuer-1');

    expect(result.duplicateHits).toBe(1);
    expect(result.blockedRows).toBe(1);
    expect(result.validRows).toBe(0);
    expect(result.rows[0].isValid).toBe(false);
    expect(result.rows[0].duplicateCheck?.isDuplicate).toBe(true);
    expect(result.rows[0].duplicateCheck?.action).toBe('block');
  });

  it('allows duplicate warnings to pass when overrideReason is provided', async () => {
    const csv = [
      'recipientEmail,recipientName,title',
      'student1@example.com,John Doe,Web Dev Certificate',
    ].join('\n');

    mockDuplicateDetectionService.checkForDuplicates.mockResolvedValue({
      isDuplicate: true,
      confidence: 0.85,
      action: 'warn',
      matches: [
        {
          certificateId: 'existing-cert-1',
          similarityScore: 0.85,
          matchType: 'fuzzy_title',
          title: 'Web Dev',
          recipientEmail: 'student1@example.com',
        },
      ],
      message: 'Warning match',
    });

    // Without overrideReason -> invalid
    const resultWithoutOverride = await service.processCsvBulk(
      csv,
      {},
      'issuer-1',
    );
    expect(resultWithoutOverride.validRows).toBe(0);
    expect(resultWithoutOverride.warningRows).toBe(1);

    // With overrideReason -> valid
    const resultWithOverride = await service.processCsvBulk(
      csv,
      { overrideReason: 'Valid annual re-certification' },
      'issuer-1',
    );
    expect(resultWithOverride.validRows).toBe(1);
    expect(resultWithOverride.canQueue).toBe(true);
  });
});
