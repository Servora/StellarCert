import { IsOptional, IsString, IsDateString, IsEnum, IsUUID } from 'class-validator';
import { AuditAction, AuditResourceType } from '../constants';
import { Type } from 'class-transformer';

export class AuditSearchDto {
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @IsOptional()
  @IsEnum(AuditResourceType)
  resourceType?: AuditResourceType;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsString()
  userEmail?: string;

  @IsOptional()
  @IsString()
  resourceId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  skip?: number = 0;

  @IsOptional()
  @Type(() => Number)
  take?: number = 50;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsString()
  status?: 'success' | 'failure' | 'error';
}
