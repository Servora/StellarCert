import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BulkIssuePreviewDto {
  @ApiPropertyOptional({
    description: 'Metadata schema ID to validate certificate rows against',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  metadataSchemaId?: string;

  @ApiPropertyOptional({
    description: 'Template UUID to assign to all certificates in this bulk issuance',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiPropertyOptional({
    description: 'Optional override reason if duplicates are detected and need to be bypassed',
  })
  @IsOptional()
  @IsString()
  overrideReason?: string;
}

export interface BulkIssueRowPreview {
  rowIndex: number;
  recipientEmail: string;
  recipientName: string;
  title: string;
  isValid: boolean;
  validationErrors: string[];
  duplicateCheck?: {
    isDuplicate: boolean;
    action: 'block' | 'warn' | 'allow';
    confidence: number;
    matches: Array<{
      certificateId: string;
      similarityScore: number;
      matchType: string;
      title: string;
      recipientEmail: string;
    }>;
    message?: string;
  };
}

export interface BulkIssueDryRunResponseDto {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateHits: number;
  blockedRows: number;
  warningRows: number;
  schemaId?: string;
  schemaVersion?: string;
  rows: BulkIssueRowPreview[];
  jobId?: string;
  canQueue: boolean;
}
