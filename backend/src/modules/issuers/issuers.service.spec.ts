import { IssuersService } from './issuers.service';

describe('IssuersService.listIssuers', () => {
  const qb: Record<string, jest.Mock> = {};
  for (const m of ['andWhere', 'orderBy', 'skip', 'take']) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getManyAndCount = jest.fn();
  const repo = { createQueryBuilder: jest.fn(() => qb) };
  let service: IssuersService;

  beforeEach(() => {
    jest.resetAllMocks();
    repo.createQueryBuilder.mockImplementation(() => qb);
    for (const m of ['andWhere', 'orderBy', 'skip', 'take']) {
      qb[m].mockImplementation(() => qb);
    }
    qb.getManyAndCount.mockResolvedValue([[{ id: 'i1' }], 45]);
    service = new IssuersService(repo as never);
  });

  it('pages at the database and reports metadata', async () => {
    const result = await service.listIssuers({ page: 2, limit: 20 });

    expect(qb.skip).toHaveBeenCalledWith(20);
    expect(qb.take).toHaveBeenCalledWith(20);
    expect(result.meta).toEqual({
      total: 45,
      page: 2,
      limit: 20,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it('pushes filters into SQL, not into JavaScript', async () => {
    await service.listIssuers({
      isActive: true,
      search: 'acme',
      tier: 'paid' as never,
    });

    expect(qb.andWhere).toHaveBeenCalledWith('issuer.isActive = :isActive', {
      isActive: true,
    });
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(issuer.name ILIKE :search OR issuer.stellarPublicKey ILIKE :search)',
      { search: '%acme%' },
    );
    expect(qb.andWhere).toHaveBeenCalledWith('issuer.tier = :tier', {
      tier: 'paid',
    });
  });

  it('never takes more than the maximum page size, even when called directly', async () => {
    await service.listIssuers({ limit: 5_000_000 });
    expect(qb.take).toHaveBeenCalledWith(100);
  });

  it('copes with string paging values that skipped validation', async () => {
    await service.listIssuers({ page: '3' as never, limit: '10' as never });
    expect(qb.skip).toHaveBeenCalledWith(20);
    expect(qb.take).toHaveBeenCalledWith(10);
  });

  it('falls back to a safe sort column', async () => {
    await service.listIssuers({ sortBy: 'passwordHash; DROP TABLE' });
    expect(qb.orderBy).toHaveBeenCalledWith('issuer.createdAt', 'DESC');
  });
});
