import {
  IsString,
  IsEmail,
  IsOptional,
  IsUUID,
  IsDate,
  IsObject,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCertificateDto {
  @ApiPropertyOptional({
    description: 'Optional issuer UUID for the certificate',
    example: '5f1e8a8d-8f58-4c8b-88d4-5d0a8c9dbf2a',
  })
  @IsOptional()
  @IsUUID()
  issuerId: string;

  @ApiPropertyOptional({
    description: 'Optional recipient user UUID',
    example: '7c2e9b1f-3d4a-4e5b-9c8d-1a2b3c4d5e6f',
  })
  @IsOptional()
  @IsUUID()
  recipientId?: string;

  @ApiProperty({
    description: 'Recipient email address',
    example: 'recipient@example.com',
  })
  @IsEmail()
  recipientEmail: string;

  @ApiProperty({
    description: 'Recipient full name',
    example: 'Jane Doe',
  })
  @IsString()
  recipientName: string;

  @ApiProperty({
    description: 'Certificate title',
    example: 'Introduction to Databases',
  })
  @IsString()
  title: string;

  @ApiPropertyOptional({
    description: 'Detailed certificate description',
    example: 'Completed the introductory database course with distinction.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Optional pre-generated verification code',
    example: 'CERT-2026-001',
  })
  @IsOptional()
  @IsString()
  verificationCode?: string;

  @ApiPropertyOptional({
    description: 'Certificate expiration date (ISO 8601)',
    example: '2027-04-27T00:00:00Z',
  })
  @IsOptional()
  @Type(() => Date)
  expiresAt?: Date;

  @ApiPropertyOptional({
    description: 'Metadata schema ID used for validation',
    example: '3d9a2f01-5c9f-4fa7-a6f6-2b0febc6e2c1',
  })
  @IsOptional()
  @IsUUID()
  metadataSchemaId?: string;

  @ApiPropertyOptional({
    description: 'Template UUID to use when generating the certificate',
    example: '7b8f9c2d-8e4f-40ff-bc1d-9f8d7c6e5b4a',
  })
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiPropertyOptional({
    description: 'Course name associated with the certificate',
    example: 'Data Science Fundamentals',
  })
  @IsOptional()
  @IsString()
  courseName?: string;

  @ApiPropertyOptional({
    description: 'Additional structured metadata',
    example: { program: 'Analytics', grade: 'A', hours: 40 },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({
    description:
      'Skip recording this certificate on Soroban and store it off-chain only. ' +
      'Useful for local development and CI, which have no funded issuer key.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  skipStellar?: boolean;
}
