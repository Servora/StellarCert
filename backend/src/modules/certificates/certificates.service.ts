import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, LessThan } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Certificate } from './entities/certificate.entity';
import { Verification } from './entities/verification.entity';
import { CreateCertificateDto } from './dto/create-certificate.dto';
import { UpdateCertificateDto } from './dto/update-certificate.dto';
import { CertificateStatsDto, StatsQueryDto } from './dto/stats.dto';
import { StellarService } from '../stellar/services/stellar.service';

@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);
  private readonly CACHE_TTL = 300; // 5 minutes

  constructor(
    @InjectRepository(Certificate)
    private readonly certificateRepo: Repository<Certificate>,
    @InjectRepository(Verification)
    private readonly verificationRepo: Repository<Verification>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    private readonly stellarService: StellarService,
  ) { }

  async getStatistics(query: StatsQueryDto): Promise<CertificateStatsDto> {
    const cacheKey = `cert-stats:${JSON.stringify(query)}`;
    const cached = await this.cacheManager.get<CertificateStatsDto>(cacheKey);
    if (cached) return cached;

    const dateFilter = this.buildDateFilter(query);

    const [totalStats, issuanceTrend, verificationStats] = await Promise.all([
      this.getTotalStats(dateFilter),
      this.getIssuanceTrend(),
      this.getVerificationStats(),
    ]);

    const result: CertificateStatsDto = {
      ...totalStats,
      issuanceTrend,
      topIssuers: [], // Can be implemented later if needed
      verificationStats,
    };

    await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  private async getTotalStats(dateFilter: any) {
    const [total, active, revoked, expired] = await Promise.all([
      this.certificateRepo.count({ where: dateFilter }),
      this.certificateRepo.count({ where: { ...dateFilter, isRevoked: false } }),
      this.certificateRepo.count({ where: { ...dateFilter, isRevoked: true } }),
      this.certificateRepo.count({ where: { ...dateFilter, expiresAt: LessThan(new Date()) } }),
    ]);

    return {
      totalCertificates: total,
      activeCertificates: active,
      revokedCertificates: revoked,
      expiredCertificates: expired,
    };
  }

  private async getIssuanceTrend() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const trend = await this.certificateRepo
      .createQueryBuilder('cert')
      .select("DATE_TRUNC('day', cert.issuedAt)", 'date')
      .addSelect('COUNT(*)', 'count')
      .where('cert.issuedAt >= :date', { date: thirtyDaysAgo })
      .groupBy("DATE_TRUNC('day', cert.issuedAt)")
      .orderBy('date', 'ASC')
      .getRawMany();

    return trend.map(t => ({
      date: t.date.toISOString().split('T')[0],
      count: parseInt(t.count, 10),
    }));
  }

  private async getVerificationStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);

    const [total, successful, failed, daily, weekly] = await Promise.all([
      this.verificationRepo.count(),
      this.verificationRepo.count({ where: { success: true } }),
      this.verificationRepo.count({ where: { success: false } }),
      this.verificationRepo.count({ where: { verifiedAt: MoreThanOrEqual(today) } }),
      this.verificationRepo.count({ where: { verifiedAt: MoreThanOrEqual(lastWeek) } }),
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

  async verify(serial: string) {
    // Try finding by certificateId first, then by blockchainTxHash
    let certificate = await this.certificateRepo.findOne({
      where: [{ certificateId: serial }, { blockchainTxHash: serial }],
    });

    if (!certificate) {
      throw new NotFoundException(`Certificate with serial ${serial} not found`);
    }

    // If it has a blockchain hash, verify it on Stellar
    let blockchainValid = true;
    if (certificate.blockchainTxHash) {
      const result = await this.stellarService.verifyTransaction(certificate.blockchainTxHash);
      blockchainValid = result.successful;
    }

    const verification = this.verificationRepo.create({
      certificate,
      success: blockchainValid && !certificate.isRevoked,
    });
    await this.verificationRepo.save(verification);

    return {
      ...certificate,
      isValid: blockchainValid && !certificate.isRevoked,
      verifiedAt: verification.verifiedAt,
    };
  }

  async issue(dto: CreateCertificateDto) {
    // 1. Create on Stellar (Mock destination for now if not provided)
    const destination = dto.recipientPublicKey || (await this.stellarService.createAccount()).publicKey;
    const memo = `CERT:${dto.certificateId}`;

    const stellarResult = await this.stellarService.createCertificateTransaction(
      destination,
      memo
    );

    if (!stellarResult.successful) {
      throw new BadRequestException(`Stellar transaction failed: ${stellarResult.error}`);
    }

    // 2. Save to database
    const certificate = this.certificateRepo.create({
      ...dto,
      blockchainTxHash: stellarResult.hash,
      issuedAt: new Date(),
      isRevoked: false,
    });

    return await this.certificateRepo.save(certificate);
  }

  async findAll() {
    return await this.certificateRepo.find({ order: { issuedAt: 'DESC' } });
  }

  async findOne(id: string) {
    const cert = await this.certificateRepo.findOne({ where: { id } });
    if (!cert) throw new NotFoundException(`Certificate with ID ${id} not found`);
    return cert;
  }
}
