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

    it('returns UTC issuance day buckets as date strings', async () => {
      const trendQB = buildTrendQueryBuilder();
      trendQB.getRawMany.mockResolvedValue([
        { date: '2026-10-20', count: '1' },
      ]);
      const topIssuersQB = buildTopIssuersQueryBuilder([]);

      mockCertificateRepo.createQueryBuilder
        .mockReturnValueOnce(trendQB)
        .mockReturnValueOnce(topIssuersQB);

      const result = await service.getStatistics({});
      const utcDayBucket =
        "TO_CHAR(DATE_TRUNC('day', cert.issuedAt AT TIME ZONE 'UTC'), 'YYYY-MM-DD')";

      expect(trendQB.select).toHaveBeenCalledWith(utcDayBucket, 'date');
      expect(trendQB.groupBy).toHaveBeenCalledWith(utcDayBucket);
      expect(result.issuanceTrend).toEqual([{ date: '2026-10-20', count: 1 }]);
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

    it('filters getTotalStats counts by issuedAt only, not by the raw startDate/endDate (regression)', async () => {
      const trendQB = buildTrendQueryBuilder();
      const topIssuersQB = buildTopIssuersQueryBuilder([]);

      mockCertificateRepo.createQueryBuilder
        .mockReturnValueOnce(trendQB)
        .mockReturnValueOnce(topIssuersQB);

      // buildDateFilter() also returns raw `startDate`/`endDate` Date values
      // (used by getIssuanceTrend's fallback defaults), which are not actual
      // Certificate columns. Spreading them straight into a TypeORM `where`
      // throws EntityPropertyNotFoundError - the real cause of the
      // GET /certificates/stats?startDate=...&endDate=... 500. Only
      // `issuedAt` may reach the `where`.
      await service.getStatistics({
        startDate: '2026-11-14',
        endDate: '2026-11-20',
      });

      for (const [{ where }] of mockCertificateRepo.count.mock.calls) {
        expect(where).not.toHaveProperty('startDate');
        expect(where).not.toHaveProperty('endDate');
        expect(where).toHaveProperty('issuedAt');
      }
    });

    it('includes the entire end date in the range, not just its UTC midnight (regression)', async () => {
      const trendQB = buildTrendQueryBuilder();
      const topIssuersQB = buildTopIssuersQueryBuilder([]);

      mockCertificateRepo.createQueryBuilder
        .mockReturnValueOnce(trendQB)
        .mockReturnValueOnce(topIssuersQB);

      // A date-only `endDate` like "2026-11-20" parses to that day's UTC
      // midnight. A certificate issued later the same day (e.g. 18:00 UTC)
      // must still fall inside the range - the real cause of the dashboard
      // showing 0 certificates right after issuing one today.
      await service.getStatistics({
        startDate: '2026-11-14',
        endDate: '2026-11-20',
      });

      const [{ where }] = mockCertificateRepo.count.mock.calls[0];
      const { issuedAt } = where;
      expect(issuedAt._value[1].toISOString()).toBe('2026-11-20T23:59:59.999Z');
    });
  });

  describe('clearStatsCache', () => {
    it('deletes only cert-stats-prefixed keys from each Keyv store (regression)', async () => {
      // cache-manager v7's Cache has no `.store` (the v4/v5 shape) - it
      // exposes `.stores`, an array of Keyv instances iterable via
      // `.iterator()`. The old `.store.keys` check silently no-opped
      // against every real cache-manager v7 instance, so the dashboard
      // kept serving stale totals for up to 5 minutes after every
      // issue/revoke.
      const entries: [string, unknown][] = [
        ['cert-stats:start-2026-11-14:end-2026-11-20', { total: 0 }],
        ['cert-stats:public-summary', { total: 0 }],
        ['other-key', 'unrelated'],
      ];
      const fakeStore = {
        iterator: () => entries[Symbol.iterator](),
      };
      (service as any).cacheManager = {
        ...mockCacheManager,
        stores: [fakeStore],
      };

      await service.clearStatsCache();

      expect(mockCacheManager.del).toHaveBeenCalledWith(
        'cert-stats:start-2026-11-14:end-2026-11-20',
      );
      expect(mockCacheManager.del).toHaveBeenCalledWith(
        'cert-stats:public-summary',
      );
      expect(mockCacheManager.del).not.toHaveBeenCalledWith('other-key');
    });
  });
});
