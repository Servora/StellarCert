import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EnqueueEmailDto {
  @ApiProperty({
    example: 'recipient@example.com',
    description: 'Recipient email address',
  })
  @IsEmail()
  recipientEmail: string;

  @ApiProperty({
    example: 'noreply@stellarcert.app',
    description: 'Sender email address',
  })
  @IsEmail()
  senderEmail: string;

  @ApiProperty({
    example: 'Your certificate is ready',
    description: 'Subject line for the email',
  })
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiProperty({
    example: '<p>Your certificate has been issued.</p>',
    description: 'HTML or plaintext body of the email',
  })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({
    example: { certificateId: 'a3d8a582-bd23-4a2d-9630-6d4a2f5fd6f0' },
    description: 'Optional metadata to attach to the email job',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class EnqueuePdfDto {
  @ApiProperty({
    example: 'a3d8a582-bd23-4a2d-9630-6d4a2f5fd6f0',
    description: 'Certificate ID for which the PDF should be generated',
  })
  @IsString()
  @IsNotEmpty()
  certificateId: string;

  @ApiProperty({
    example: 'certificate.pdf',
    description: 'Desired filename for the generated PDF',
  })
  @IsString()
  @IsNotEmpty()
  filename: string;

  @ApiPropertyOptional({
    example: { layout: 'portrait', includeQr: true },
    description: 'Optional PDF rendering options',
  })
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;
}
