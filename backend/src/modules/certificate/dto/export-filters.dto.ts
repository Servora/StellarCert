import {
  IsOptional,
  IsString,
  IsDateString,
  IsArray,
  IsUUID,
  ArrayMaxSize,
  ValidateNested,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const MAX_BULK_EXPORT_IDS = 100;
export const MAX_EXPORT_LIMIT = 1000;
export const MAX_PAGE_LIMIT = 100;

export class ExportFiltersDto {
  @ApiPropertyOptional({
    description: 'Full text search filter for exported certificates',
    example: 'data science',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Certificate status filter for export',
    example: 'active',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: 'Export start date (ISO 8601)',
    example: '2026-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Export end date (ISO 8601)',
    example: '2026-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Filter by issuer ID (admin only or scoped to caller)',
    example: '5f1e8a8d-8f58-4c8b-88d4-5d0a8c9dbf2a',
  })
  @IsOptional()
  @IsUUID()
  issuerId?: string;

  @ApiPropertyOptional({
    description: 'Maximum number of certificates to export',
    example: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_EXPORT_LIMIT)
  limit?: number;
}

export class BulkExportDto {
  @ApiPropertyOptional({
    description: 'List of certificate IDs to export',
    example: ['a3d8a582-bd23-4a2d-9630-6d4a2f5fd6f0'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  @ArrayMaxSize(MAX_BULK_EXPORT_IDS)
  certificateIds?: string[];

  @ApiPropertyOptional({
    description: 'Optional filters to apply to the bulk export',
    type: ExportFiltersDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExportFiltersDto)
  filters?: ExportFiltersDto;
}
