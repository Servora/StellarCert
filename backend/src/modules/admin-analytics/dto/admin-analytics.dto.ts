import { IsOptional, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query parameters for admin analytics endpoint
 */
export class AdminAnalyticsQueryDto {
  @ApiPropertyOptional({ description: 'Start date for analytics period' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date for analytics period' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

/**
 * User count breakdown by role
 */
export class UsersByRoleDto {
  @ApiPropertyOptional({ description: 'Number of regular users' })
  users: number;

  @ApiPropertyOptional({ description: 'Number of issuers' })
  issuers: number;

  @ApiPropertyOptional({ description: 'Number of admins' })
  admins: number;

  @ApiPropertyOptional({ description: 'Number of auditors' })
  auditors: number;

  @ApiPropertyOptional({ description: 'Number of recipients' })
  recipients: number;

  @ApiPropertyOptional({ description: 'Number of verifiers' })
  verifiers: number;

  @ApiPropertyOptional({ description: 'Total users across all roles' })
  total: number;
}

/**
 * User count breakdown by status
 */
export class UsersByStatusDto {
  @ApiPropertyOptional({ description: 'Number of active users' })
  active: number;

  @ApiPropertyOptional({ description: 'Number of inactive users' })
  inactive: number;

  @ApiPropertyOptional({ description: 'Number of suspended users' })
  suspended: number;

  @ApiPropertyOptional({ description: 'Number of users pending verification' })
  pendingVerification: number;
}

/**
 * Certificate count breakdown by status
 */
export class CertificatesByStatusDto {
  @ApiPropertyOptional({ description: 'Number of active certificates' })
  active: number;

  @ApiPropertyOptional({ description: 'Number of revoked certificates' })
  revoked: number;

  @ApiPropertyOptional({ description: 'Number of expired certificates' })
  expired: number;

  @ApiPropertyOptional({ description: 'Total certificates' })
  total: number;
}

/**
 * Top issuer information
 */
export class TopIssuerAnalyticsDto {
  @ApiPropertyOptional({ description: 'Issuer ID' })
  issuerId: string;

  @ApiPropertyOptional({ description: 'Issuer name' })
  issuerName: string;

  @ApiPropertyOptional({ description: 'Number of certificates issued' })
  certificateCount: number;

  @ApiPropertyOptional({ description: 'Percentage of total certificates' })
  percentage: number;
}

/**
 * System-wide verification trends
 */
export class VerificationTrendsDto {
  @ApiPropertyOptional({ description: 'Total verifications in period' })
  total: number;

  @ApiPropertyOptional({ description: 'Successful verifications' })
  successful: number;

  @ApiPropertyOptional({ description: 'Failed verifications' })
  failed: number;

  @ApiPropertyOptional({ description: 'Success rate percentage' })
  successRate: number;

  @ApiPropertyOptional({ description: 'Verifications in last 24 hours' })
  last24Hours: number;

  @ApiPropertyOptional({ description: 'Verifications in last 7 days' })
  last7Days: number;

  @ApiPropertyOptional({ description: 'Verifications in last 30 days' })
  last30Days: number;
}

/**
 * User registration trend data point
 */
export class UserRegistrationTrendDto {
  @ApiPropertyOptional({ description: 'Date' })
  date: string;

  @ApiPropertyOptional({ description: 'Number of new users' })
  count: number;
}

/**
 * Certificate issuance trend data point
 */
export class CertificateIssuanceTrendDto {
  @ApiPropertyOptional({ description: 'Date' })
  date: string;

  @ApiPropertyOptional({ description: 'Number of certificates issued' })
  count: number;
}

/**
 * Complete admin analytics response
 */
export class AdminAnalyticsDto {
  @ApiPropertyOptional({ description: 'User statistics by role' })
  usersByRole: UsersByRoleDto;

  @ApiPropertyOptional({ description: 'User statistics by status' })
  usersByStatus: UsersByStatusDto;

  @ApiPropertyOptional({ description: 'Certificate statistics by status' })
  certificatesByStatus: CertificatesByStatusDto;

  @ApiPropertyOptional({ description: 'Top issuing organizations' })
  topIssuers: TopIssuerAnalyticsDto[];

  @ApiPropertyOptional({ description: 'System-wide verification trends' })
  verificationTrends: VerificationTrendsDto;

  @ApiPropertyOptional({ description: 'User registration trends over time' })
  userRegistrationTrend: UserRegistrationTrendDto[];

  @ApiPropertyOptional({ description: 'Certificate issuance trends over time' })
  certificateIssuanceTrend: CertificateIssuanceTrendDto[];

  @ApiPropertyOptional({ description: 'Total number of issuers in system' })
  totalIssuers: number;
}
