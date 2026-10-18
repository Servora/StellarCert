import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AdminAnalyticsService } from './admin-analytics.service';
import { User } from '../../users/entities/user.entity';
import { Certificate } from '../../certificate/entities/certificate.entity';
import { Verification } from '../../certificate/entities/verification.entity';
import { Issuer } from '../../issuers/entities/issuer.entity';
import { CertificateStatsService } from '../../certificate/services/stats.service';

/**
 * Minimal chainable query-builder stub: every builder call returns the builder,
 * and the terminal calls resolve to empty results.
 */
function queryBuilderStub() {
  const qb: Record<string, jest.Mock> = {};
  for (const method of [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'groupBy',
    'orderBy',
    'leftJoinAndSelect',
  ]) {
    qb[method] = jest.fn(() => qb);
  }
  qb.getRawMany = jest.fn(async () => []);
  qb.getCount = jest.fn(async () => 0);
  qb.getOne = jest.fn(async () => null);
  return qb;
}

describe('AdminAnalyticsService cache TTL unit (#731)', () => {
  const CACHE_TTL_MS = 2 * 60 * 1000;
  const cacheManager = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };
  const certificateStatsService = {
    getTopIssuersData: jest.fn(async () => []),
  };

  let service: AdminAnalyticsService;

  const repositoryStub = () => ({
    count: jest.fn(async () => 0),
    createQueryBuilder: jest.fn(() => queryBuilderStub()),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    cacheManager.get.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAnalyticsService,
        { provide: getRepositoryToken(User), useValue: repositoryStub() },
        { provide: getRepositoryToken(Certificate), useValue: repositoryStub() },
        {
          provide: getRepositoryToken(Verification),
          useValue: repositoryStub(),
        },
        { provide: getRepositoryToken(Issuer), useValue: repositoryStub() },
        { provide: CACHE_MANAGER, useValue: cacheManager },
        { provide: CertificateStatsService, useValue: certificateStatsService },
      ],
    }).compile();

    service = module.get<AdminAnalyticsService>(AdminAnalyticsService);
  });

  it('caches analytics for 2 minutes expressed in milliseconds', async () => {
    await service.getAnalytics({});

    expect(cacheManager.set).toHaveBeenCalledTimes(1);
    const [key, , ttl] = cacheManager.set.mock.calls[0];
    expect(key).toBe('admin-analytics');
    // 120_000 ms = 2 minutes. A seconds value (120) would expire almost
    // immediately; a seconds value multiplied by 1000 (120_000 seconds)
    // would live for ~33 hours.
    expect(ttl).toBe(CACHE_TTL_MS);
    expect(ttl).toBe(120_000);
  });

  it('returns the cached payload without recomputing', async () => {
    const cached = { totalIssuers: 7 };
    cacheManager.get.mockResolvedValue(cached);

    const result = await service.getAnalytics({});

    expect(result).toBe(cached);
    expect(cacheManager.set).not.toHaveBeenCalled();
  });
});
