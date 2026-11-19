import { IsEmail, IsOptional, IsString } from 'class-validator';

export class SendTransferConfirmationDto {
  @IsEmail()
  to: string;

  @IsOptional()
  @IsString()
  recipientName?: string;

  @IsString()
  certificateTitle: string;

  @IsString()
  certificateId: string;

  /** One-time code the new owner needs to approve the transfer. */
  @IsString()
  confirmationCode: string;
}
