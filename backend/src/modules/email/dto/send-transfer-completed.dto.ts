import { IsEmail, IsOptional, IsString } from 'class-validator';

export class SendTransferCompletedDto {
  @IsEmail()
  to: string;

  @IsOptional()
  @IsString()
  recipientName?: string;

  @IsString()
  certificateTitle: string;

  @IsString()
  certificateId: string;
}
