import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AdminAnalyticsService } from './admin-analytics.service';
import { User, UserRole } from '../../users/entities/user.entity';
import { Certificate } from '../../certificate/entities/certificate.entity';
import { Verification } from '../../certificate/entities/verification.entity';
import { Issuer } from '../../issuers/entities/issuer.entity';
import { CertificateStatsService } from '../../certificate/services/stats.service';

function builder(rows: unknown[]) {
  const qb: Record<string, jest.Mock> = {};
  for (const m of [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'groupBy',
    'orderBy',
    'leftJoinAndSelect',
  ]) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getRawMany = jest.fn().mockResolvedValue(rows);
  qb.getCount = jest.fn().mockResolvedValue(0);
  return qb;
}

describe('AdminAnalyticsService users by role', () => {
  async function build(roleRows: unknown[]) {
    const userRepo = {
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(() => builder(roleRows)),
    };
    const otherRepo = () => ({
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(() => builder([])),
    });
    const module = await Test.createTestingModule({
      providers: [
        AdminAnalyticsService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Certificate), useValue: otherRepo() },
        { provide: getRepositoryToken(Verification), useValue: otherRepo() },
        { provide: getRepositoryToken(Issuer), useValue: otherRepo() },
        {
          provide: CACHE_MANAGER,
          useValue: { get: jest.fn(), set: jest.fn() },
        },
        {
          provide: CertificateStatsService,
          useValue: { getTopIssuersData: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();
    return module.get(AdminAnalyticsService);
  }

  it('counts all six roles from one grouped query', async () => {
    const service = await build([
      { role: UserRole.USER, count: '5' },
      { role: UserRole.ISSUER, count: '2' },
      { role: UserRole.ADMIN, count: '1' },
      { role: UserRole.AUDITOR, count: '3' },
      { role: UserRole.RECIPIENT, count: '7' },
      { role: UserRole.VERIFIER, count: '4' },
    ]);

    const { usersByRole } = await service.getAnalytics({});

    expect(usersByRole).toEqual({
      users: 5,
      issuers: 2,
      admins: 1,
      auditors: 3,
      recipients: 7,
      verifiers: 4,
      total: 22,
    });
  });

  it('fills in zero for roles nobody holds', async () => {
    const service = await build([{ role: UserRole.ADMIN, count: '1' }]);

    const { usersByRole } = await service.getAnalytics({});

    expect(usersByRole).toMatchObject({
      users: 0,
      issuers: 0,
      admins: 1,
      auditors: 0,
      recipients: 0,
      verifiers: 0,
      total: 1,
    });
  });
});
