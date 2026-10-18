import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { CertificateStatsService } from './stats.service';
import { Certificate } from '../entities/certificate.entity';
import { Verification } from '../entities/verification.entity';

describe('CertificateStatsService', () => {
  let service: CertificateStatsService;

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  const mockCertificateRepo = {
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockVerificationRepo = {
    count: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificateStatsService,
        {
          provide: getRepositoryToken(Certificate),
          useValue: mockCertificateRepo,
        },
        {
          provide: getRepositoryToken(Verification),
          useValue: mockVerificationRepo,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    service = module.get<CertificateStatsService>(CertificateStatsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getStatistics -> getTopIssuers', () => {
    // Builds a chainable mock query builder covering both createQueryBuilder()
    // calls made by getStatistics: one from getIssuanceTrend, one from
    // getTopIssuers. Each call site gets its own mock via mockReturnValueOnce.
    const buildTrendQueryBuilder = () => ({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    });

    const buildTopIssuersQueryBuilder = (rawRows: any[]) => ({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(rawRows),
    });

    beforeEach(() => {
      mockCacheManager.get.mockResolvedValue(null);
      mockCertificateRepo.count.mockResolvedValue(0);
      mockVerificationRepo.count.mockResolvedValue(0);
    });

    it('joins the real User entity and selects/groups by its actual firstName/lastName columns', async () => {
      const trendQB = buildTrendQueryBuilder();
      const topIssuersQB = buildTopIssuersQueryBuilder([
        {
          issuerId: 'issuer-1',
          firstName: 'Acme',
          lastName: 'University',
          certificateCount: '3',
        },
      ]);

      mockCertificateRepo.createQueryBuilder
        .mockReturnValueOnce(trendQB)
        .mockReturnValueOnce(topIssuersQB);

      const result = await service.getStatistics({});

      // Certificate.issuer is a ManyToOne relation to the User entity, which
      // has real `firstName`/`lastName` columns (User has no `name` column).
      // The query must join it and select/group by those real columns.
      expect(topIssuersQB.leftJoin).toHaveBeenCalledWith(
        'cert.issuer',
        'issuer',
      );
      expect(topIssuersQB.addSelect).toHaveBeenCalledWith(
        'issuer.firstName',
        'firstName',
      );
      expect(topIssuersQB.addSelect).toHaveBeenCalledWith(
        'issuer.lastName',
        'lastName',
      );
      expect(topIssuersQB.addGroupBy).toHaveBeenCalledWith('issuer.firstName');
      expect(topIssuersQB.addGroupBy).toHaveBeenCalledWith('issuer.lastName');

      expect(result.topIssuers).toEqual([
        {
          issuerId: 'issuer-1',
          issuerName: 'Acme University',
          certificateCount: 3,
        },
      ]);
    });

    it('double-quotes the raw "certificateCount" alias in ORDER BY so Postgres does not case-fold it away', async () => {
      const trendQB = buildTrendQueryBuilder();
      const topIssuersQB = buildTopIssuersQueryBuilder([]);

      mockCertificateRepo.createQueryBuilder
        .mockReturnValueOnce(trendQB)
        .mockReturnValueOnce(topIssuersQB);

      await service.getStatistics({});

      // Regression guard: `COUNT(*) AS "certificateCount"` is emitted as a
      // double-quoted (case-preserving) alias. Ordering by the bare,
      // unquoted identifier `certificateCount` gets case-folded by Postgres
      // to `certificatecount`, which does not match and raises
      // "column certificatecount does not exist" - the real cause of the
      // GET /certificates/stats 500. The alias reference must stay quoted.
      expect(topIssuersQB.orderBy).toHaveBeenCalledWith(
        '"certificateCount"',
        'DESC',
      );
    });

    it('falls back to "Unknown" when the joined issuer name is null', async () => {
      const trendQB = buildTrendQueryBuilder();
      const topIssuersQB = buildTopIssuersQueryBuilder([
        { issuerId: 'issuer-2', issuerName: null, certificateCount: '1' },
      ]);

      mockCertificateRepo.createQueryBuilder
        .mockReturnValueOnce(trendQB)
        .mockReturnValueOnce(topIssuersQB);

      const result = await service.getStatistics({});

      expect(result.topIssuers).toEqual([
        { issuerId: 'issuer-2', issuerName: 'Unknown', certificateCount: 1 },
      ]);
    });
  });
});
