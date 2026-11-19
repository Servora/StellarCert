import {
  IsString,
  IsEmail,
  IsOptional,
  IsNotEmpty,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransferStatus } from '../entities/certificate-transfer.entity';

export class InitiateTransferDto {
  @ApiProperty({
    description: 'ID of the certificate to transfer',
    example: 'a3d8a582-bd23-4a2d-9630-6d5af5fd6f0',
  })
  @IsString()
  @IsNotEmpty()
  certificateId: string;

  @ApiProperty({
    description: 'Email of the new owner',
    example: 'new.owner@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  newOwnerEmail: string;

  @ApiProperty({
    description: 'Name of the new owner',
    example: 'New Owner',
  })
  @IsString()
  @IsNotEmpty()
  newOwnerName: string;

  @ApiPropertyOptional({
    description: 'Reason for the transfer',
    example: 'Recipient changed employers',
  })
  @IsString()
  @IsOptional()
  reason?: string;
}

export class ApproveTransferDto {
  @ApiProperty({
    description: 'Transfer request ID',
    example: 'd1f7d9d9-6b42-4d9f-9b2c-e6e1f8dfc9ba',
  })
  @IsString()
  @IsNotEmpty()
  transferId: string;

  @ApiProperty({
    description: 'Confirmation code sent to the new owner',
    example: 'AB12CD34EF56',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(64)
  confirmationCode: string;
}

export class RejectTransferDto {
  @ApiProperty({
    description: 'Transfer request ID',
    example: 'd1f7d9d9-6b42-4d9f-9b2c-e6e1f8dfc9ba',
  })
  @IsString()
  @IsNotEmpty()
  transferId: string;

  @ApiPropertyOptional({
    description: 'Reason for rejection',
    example: 'Certificate owner declined transfer',
  })
  @IsString()
  @IsOptional()
  reason?: string;
}

export class TransferHistoryResponseDto {
  @ApiProperty({
    description: 'Transfer history record ID',
    example: 'd1f7d9d9-6b42-4d9f-9b2c-e6e1f8dfc9ba',
  })
  id: string;

  @ApiProperty({
    description: 'Certificate ID associated with the transfer',
    example: 'a3d8a582-bd23-4a2d-9630-6d5af5fd6f0',
  })
  certificateId: string;

  @ApiPropertyOptional({
    description: 'Email address of the previous owner',
    example: 'previous.owner@example.com',
  })
  fromEmail?: string;

  @ApiPropertyOptional({
    description: 'Name of the previous owner',
    example: 'Previous Owner',
  })
  fromName?: string;

  @ApiPropertyOptional({
    description: 'Email address of the requested new owner',
    example: 'new.owner@example.com',
  })
  toEmail?: string;

  @ApiPropertyOptional({
    description: 'Name of the requested new owner',
    example: 'New Owner',
  })
  toName?: string;

  @ApiProperty({
    description: 'Current transfer status',
    enum: TransferStatus,
    example: TransferStatus.PENDING,
  })
  status: TransferStatus;

  @ApiPropertyOptional({
    description: 'Reason provided for the transfer',
    example: 'Recipient changed employers',
  })
  reason?: string;

  @ApiPropertyOptional({
    description: 'Reason the transfer was rejected',
    example: 'Confirmation code mismatch',
  })
  rejectionReason?: string;

  @ApiProperty({
    description: 'Timestamp when the transfer was initiated',
    example: '2026-04-27T12:00:00Z',
    type: String,
    format: 'date-time',
  })
  initiatedAt: Date;

  @ApiPropertyOptional({
    description: 'Timestamp when the transfer completed',
    example: '2026-04-28T12:00:00Z',
    type: String,
    format: 'date-time',
  })
  completedAt?: Date;

  @ApiPropertyOptional({
    description: 'Expiration timestamp for the transfer confirmation code',
    example: '2026-05-04T12:00:00Z',
    type: String,
    format: 'date-time',
  })
  expiresAt?: Date;
}

export class InitiateTransferResponseDto {
  @ApiProperty({
    description: 'Transfer request ID',
    example: 'd1f7d9d9-6b42-4d9f-9b2c-e6e1f8dfc9ba',
  })
  id: string;

  @ApiProperty({
    description: 'Certificate ID associated with the transfer',
    example: 'a3d8a582-bd23-4a2d-9630-6d5af5fd6f0',
  })
  certificateId: string;

  @ApiPropertyOptional({
    description: 'Email address of the previous owner',
    example: 'previous.owner@example.com',
  })
  fromEmail?: string;

  @ApiPropertyOptional({
    description: 'Name of the previous owner',
    example: 'Previous Owner',
  })
  fromName?: string;

  @ApiPropertyOptional({
    description: 'Email address of the requested new owner',
    example: 'new.owner@example.com',
  })
  toEmail?: string;

  @ApiPropertyOptional({
    description: 'Name of the requested new owner',
    example: 'New Owner',
  })
  toName?: string;

  @ApiProperty({
    description: 'Current transfer status',
    enum: TransferStatus,
    example: TransferStatus.PENDING,
  })
  status: TransferStatus;

  @ApiPropertyOptional({
    description: 'Reason provided for the transfer',
    example: 'Recipient changed employers',
  })
  reason?: string;

  @ApiPropertyOptional({
    description: 'Timestamp when the transfer was initiated',
    example: '2026-04-27T12:00:00Z',
    type: String,
    format: 'date-time',
  })
  initiatedAt: Date;

  @ApiPropertyOptional({
    description: 'Expiration timestamp for the transfer confirmation code',
    example: '2026-05-04T12:00:00Z',
    type: String,
    format: 'date-time',
  })
  expiresAt?: Date;
}
