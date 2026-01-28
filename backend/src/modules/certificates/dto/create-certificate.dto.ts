import { IsString, IsNotEmpty, IsOptional, IsEmail, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCertificateDto {
    @ApiProperty({ description: 'Unique certificate ID' })
    @IsString()
    @IsNotEmpty()
    certificateId: string;

    @ApiProperty({ description: 'Title of the certificate' })
    @IsString()
    @IsNotEmpty()
    title: string;

    @ApiPropertyOptional({ description: 'Description of the certificate' })
    @IsString()
    @IsOptional()
    description?: string;

    @ApiProperty({ description: 'Name of the issuer' })
    @IsString()
    @IsNotEmpty()
    issuerName: string;

    @ApiProperty({ description: 'Email address of the recipient' })
    @IsEmail()
    @IsNotEmpty()
    recipientEmail: string;

    @ApiPropertyOptional({ description: 'Stellar public key of the recipient' })
    @IsString()
    @IsOptional()
    recipientPublicKey?: string;

    @ApiPropertyOptional({ description: 'Expiration date of the certificate' })
    @IsDateString()
    @IsOptional()
    expiresAt?: string;
}
