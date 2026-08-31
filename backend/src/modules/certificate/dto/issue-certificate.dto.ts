import {
  IsString,
  IsEmail,
  IsOptional,
  IsUUID,
  IsDateString,
  IsObject,
  MinLength,
  MaxLength,
  IsArray,
  IsNumber,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class IssueCertificateDto {
  @ApiPropertyOptional({
    description: 'Issuer UUID (overridden by authenticated user id)',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  issuerId?: string;

  @ApiPropertyOptional({
    description: 'Recipient user UUID (if recipient is a registered user)',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  recipientId?: string;

  @ApiProperty({ description: 'Recipient email address' })
  @IsEmail()
  recipientEmail: string;

  @ApiProperty({ description: 'Full name of recipient' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  recipientName: string;

  @ApiPropertyOptional({
    description: "Recipient's Stellar public key address",
  })
  @IsOptional()
  @IsString()
  recipientStellarAddress?: string;

  @ApiProperty({ description: 'Certificate title' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title: string;

  @ApiPropertyOptional({ description: 'Certificate description' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Custom pre-generated verification code',
  })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  verificationCode?: string;

  @ApiPropertyOptional({
    description: 'Certificate expiration date (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({
    description: 'Metadata schema ID to validate certificate metadata against',
  })
  @IsOptional()
  @IsUUID()
  metadataSchemaId?: string;

  @ApiPropertyOptional({ description: 'Certificate metadata' })
  @IsOptional()
  @IsObject()
  metadata?: {
    program?: string;
    course?: string;
    skills?: string[];
    grade?: string;
    hours?: number;
    issuedByOrganization?: string;
    additionalFields?: Record<string, unknown>;
  };

  @ApiPropertyOptional({ description: 'Issuer name (for display purposes)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  issuerName?: string;

  @ApiPropertyOptional({
    description:
      "Issuer's Stellar public key address for direct recipient payment",
  })
  @IsOptional()
  @IsString()
  issuerStellarAddress?: string;

  @ApiPropertyOptional({
    description: 'Skip Stellar transaction recording (default: false)',
  })
  @IsOptional()
  skipStellar?: boolean;

  @ApiPropertyOptional({
    description: 'Course name associated with the certificate',
  })
  @IsOptional()
  @IsString()
  courseName?: string;

  @ApiPropertyOptional({
    description: 'Template UUID to use when generating the certificate',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  templateId?: string;
}

export class IssueCertificateBatchDto {
  @ApiProperty({ type: [IssueCertificateDto] })
  @IsArray()
  @Type(() => IssueCertificateDto)
  certificates: IssueCertificateDto[];

  @ApiPropertyOptional({
    description: 'Issuer UUID (applied to all if not set per certificate)',
  })
  @IsOptional()
  @IsUUID()
  defaultIssuerId?: string;

  @ApiPropertyOptional({
    description: 'Maximum number of certificates in batch',
    default: 50,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  batchSize?: number;
}
