import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Certificate } from '../entities/certificate.entity';
import { StatsQueryDto, CertificateStatsDto } from '../dto/stats.dto';
import { Verification } from '../entities/verification.entity';

@Injectable()
export class CertificateStatsService {
  private readonly CACHE_TTL = 300; // 5 minutes in seconds

  constructor(
    @InjectRepository(Certificate)
    private certificateRepo: Repository<Certificate>,
    @InjectRepository(Verification)
    private verificationRepo: Repository<Verification>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  async getStatistics(query: StatsQueryDto): Promise<CertificateStatsDto> {
    const cacheKey = this.generateCacheKey(query);

    // Try to get from cache
    const cached = await this.cacheManager.get<CertificateStatsDto>(cacheKey);
    if (cached) {
      return cached;
    }

    // Build date range filter
    const dateFilter = this.buildDateFilter(query);
    const issuerFilter = query.issuerId ? { issuerId: query.issuerId } : {};

    // Fetch all statistics in parallel
    const [totalStats, issuanceTrend, topIssuers, verificationStats] =
      await Promise.all([
        this.getTotalStats(dateFilter, issuerFilter),
        this.getIssuanceTrend(dateFilter, issuerFilter),
        this.getTopIssuers(dateFilter),
        this.getVerificationStats(dateFilter, issuerFilter),
      ]);

    const result: CertificateStatsDto = {
      ...totalStats,
      issuanceTrend,
      topIssuers,
      verificationStats,
    };

    // Cache the result
    await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);

    return result;
  }

  private async getTotalStats(dateFilter: any, issuerFilter: any) {
    const where = { ...dateFilter, ...issuerFilter };

    const [total, active, revoked, expired] = await Promise.all([
      this.certificateRepo.count({ where }),
      this.certificateRepo.count({
        where: { ...where, status: 'active' },
      }),
      this.certificateRepo.count({
        where: { ...where, status: 'revoked' },
      }),
      this.certificateRepo.count({
        where: { ...where, status: 'expired' },
      }),
    ]);

    return {
      totalCertificates: total,
      activeCertificates: active,
      revokedCertificates: revoked,
      expiredCertificates: expired,
    };
  }

  private async getIssuanceTrend(dateFilter: any, issuerFilter: any) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const trendData = await this.certificateRepo
      .createQueryBuilder('cert')
      .select('DATE(cert.issuedAt)', 'date')
      .addSelect('COUNT(*)', 'count')
      .where('cert.issuedAt >= :startDate', { startDate: thirtyDaysAgo })
      .andWhere(dateFilter.issuedAt ? 'cert.issuedAt <= :endDate' : '1=1', {
        endDate: dateFilter.issuedAt?.value,
      })
      .andWhere(issuerFilter.issuerId ? 'cert.issuerId = :issuerId' : '1=1', {
        issuerId: issuerFilter.issuerId,
      })
      .groupBy('DATE(cert.issuedAt)')
      .orderBy('date', 'ASC')
      .getRawMany();

    return trendData.map((item) => ({
      date: item.date,
      count: parseInt(item.count, 10),
    }));
  }

  private async getTopIssuers(dateFilter: any) {
    const topIssuersData = await this.certificateRepo
      .createQueryBuilder('cert')
      .select('cert.issuerId', 'issuerId')
      .addSelect('issuer.name', 'issuerName')
      .addSelect('COUNT(*)', 'certificateCount')
      .leftJoin('cert.issuer', 'issuer')
      .where(
        dateFilter.issuedAt ? 'cert.issuedAt BETWEEN :start AND :end' : '1=1',
        {
          start: dateFilter.issuedAt?.value?.[0],
          end: dateFilter.issuedAt?.value?.[1],
        },
      )
      .groupBy('cert.issuerId')
      .addGroupBy('issuer.name')
      .orderBy('certificateCount', 'DESC')
      .limit(10)
      .getRawMany();

    return topIssuersData.map((item) => ({
      issuerId: item.issuerId,
      issuerName: item.issuerName || 'Unknown',
      certificateCount: parseInt(item.certificateCount, 10),
    }));
  }

  private async getVerificationStats(dateFilter: any, issuerFilter: any) {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const baseWhere: any = issuerFilter.issuerId
      ? { certificate: { issuerId: issuerFilter.issuerId } }
      : {};

    const [total, successful, failed, daily, weekly] = await Promise.all([
      this.verificationRepo.count({ where: baseWhere }),
      this.verificationRepo.count({
        where: { ...baseWhere, success: true },
      }),
      this.verificationRepo.count({
        where: { ...baseWhere, success: false },
      }),
      this.verificationRepo.count({
        where: {
          ...baseWhere,
          verifiedAt: MoreThanOrEqual(oneDayAgo),
        },
      }),
      this.verificationRepo.count({
        where: {
          ...baseWhere,
          verifiedAt: MoreThanOrEqual(sevenDaysAgo),
        },
      }),
    ]);

    return {
      totalVerifications: total,
      successfulVerifications: successful,
      failedVerifications: failed,
      dailyVerifications: daily,
      weeklyVerifications: weekly,
    };
  }

  private buildDateFilter(query: StatsQueryDto) {
    if (query.startDate && query.endDate) {
      return {
        issuedAt: Between(new Date(query.startDate), new Date(query.endDate)),
      };
    }
    return {};
  }

  private generateCacheKey(query: StatsQueryDto): string {
    const parts = ['cert-stats'];
    if (query.startDate) parts.push(`start-${query.startDate}`);
    if (query.endDate) parts.push(`end-${query.endDate}`);
    if (query.issuerId) parts.push(`issuer-${query.issuerId}`);
    return parts.join(':');
  }

  async clearStatsCache(): Promise<void> {
    // Clear all stats-related cache entries
    const store = (this.cacheManager as any).store;
    if (store && store.keys) {
        const keys = await store.keys();
        const statsKeys = keys.filter((key: string) => key.startsWith('cert-stats'));
        await Promise.all(statsKeys.map((key: string) => this.cacheManager.del(key)));
    }
  }
}
