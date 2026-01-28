import { IsOptional, IsDateString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class StatsQueryDto {
    @ApiPropertyOptional({ description: 'Start date for filtering' })
    @IsOptional()
    @IsDateString()
    startDate?: string;

    @ApiPropertyOptional({ description: 'End date for filtering' })
    @IsOptional()
    @IsDateString()
    endDate?: string;

    @ApiPropertyOptional({ description: 'Filter by issuer ID' })
    @IsOptional()
    @IsUUID()
    issuerId?: string;
}

export class IssuanceTrendDto {
    date: string;
    count: number;
}

export class TopIssuerDto {
    issuerId: string;
    issuerName: string;
    certificateCount: number;
}

export class VerificationStatsDto {
    totalVerifications: number;
    successfulVerifications: number;
    failedVerifications: number;
    dailyVerifications: number;
    weeklyVerifications: number;
}

export class CertificateStatsDto {
    totalCertificates: number;
    activeCertificates: number;
    revokedCertificates: number;
    expiredCertificates: number;
    issuanceTrend: IssuanceTrendDto[];
    topIssuers: TopIssuerDto[];
    verificationStats: VerificationStatsDto;
}
