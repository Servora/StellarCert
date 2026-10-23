import {
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class VerifyCertificateDto {
  @ApiPropertyOptional({
    description: 'Alphanumeric verification code printed on certificate',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  verificationCode?: string;

  @ApiPropertyOptional({ description: 'Stellar blockchain transaction hash' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  stellarTransactionHash?: string;

  @ApiPropertyOptional({ description: 'Certificate database UUID' })
  @IsOptional()
  @IsUUID()
  certificateId?: string;
}

export class VerificationQueryDto {
  @ApiPropertyOptional({
    description: 'Verifier identity (name or ID) for audit trail',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  verifiedBy?: string;
}
