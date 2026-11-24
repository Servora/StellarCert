import 'reflect-metadata';
import { plainToClass } from 'class-transformer';
import { validate } from 'class-validator';
import { IssuerPaginationQueryDto } from './pagination.dto';
import { IssuerTier } from '../../../common/rate-limiting/rate-limit.types';

// Mirrors RequestValidationPipe: transform the raw query, then validate with
// whitelist + forbidNonWhitelisted.
async function check(query: Record<string, unknown>) {
  const dto = plainToClass(IssuerPaginationQueryDto, query);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  });
  return { dto, errors, fields: errors.map((e) => e.property).sort() };
}

describe('IssuerPaginationQueryDto', () => {
  it('accepts an empty query and applies the defaults', async () => {
    const { dto, errors } = await check({});
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(dto.sortBy).toBe('createdAt');
    expect(dto.sortOrder).toBe('DESC');
  });

  it('accepts every documented filter and converts query strings', async () => {
    const { dto, errors } = await check({
      page: '2',
      limit: '50',
      sortBy: 'name',
      sortOrder: 'ASC',
      isActive: 'true',
      search: 'acme',
      tier: IssuerTier.PAID,
    });
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({
      page: 2,
      limit: 50,
      sortBy: 'name',
      sortOrder: 'ASC',
      isActive: true,
      search: 'acme',
      tier: IssuerTier.PAID,
    });
  });

  it('converts isActive=false to a real boolean', async () => {
    const { dto, errors } = await check({ isActive: 'false' });
    expect(errors).toHaveLength(0);
    expect(dto.isActive).toBe(false);
  });

  it('rejects a page size above the maximum of 100', async () => {
    expect((await check({ limit: '101' })).fields).toEqual(['limit']);
    expect((await check({ limit: '100000000' })).fields).toEqual(['limit']);
    expect((await check({ limit: '100' })).errors).toHaveLength(0);
  });

  it('rejects non-positive and non-integer paging values', async () => {
    expect((await check({ limit: '0' })).fields).toEqual(['limit']);
    expect((await check({ page: '0' })).fields).toEqual(['page']);
    expect((await check({ page: '-1' })).fields).toEqual(['page']);
    expect((await check({ page: '1.5' })).fields).toEqual(['page']);
    expect((await check({ page: 'abc' })).fields).toEqual(['page']);
  });

  it('rejects unknown sort fields, sort orders and tiers', async () => {
    expect((await check({ sortBy: 'password' })).fields).toEqual(['sortBy']);
    expect((await check({ sortOrder: 'sideways' })).fields).toEqual([
      'sortOrder',
    ]);
    expect((await check({ tier: 'PLATINUM' })).fields).toEqual(['tier']);
  });

  it('rejects an oversized search term and unknown properties', async () => {
    expect((await check({ search: 'x'.repeat(101) })).fields).toEqual([
      'search',
    ]);
    expect((await check({ offset: '5' })).fields).toEqual(['offset']);
  });
});
