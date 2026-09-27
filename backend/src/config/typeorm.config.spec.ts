import { createTypeOrmConfig, SCHEMA_SYNCHRONIZE } from './typeorm.config';

describe('typeOrmConfig (#956)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('never enables synchronize, even when TYPEORM_SYNCHRONIZE=true', () => {
    process.env.TYPEORM_SYNCHRONIZE = 'true';

    expect(SCHEMA_SYNCHRONIZE).toBe(false);
    expect(createTypeOrmConfig().synchronize).toBe(false);
  });

  it('never enables synchronize for any TYPEORM_SYNCHRONIZE value', () => {
    for (const value of [undefined, 'true', 'false', '1', 'yes']) {
      if (value === undefined) {
        delete process.env.TYPEORM_SYNCHRONIZE;
      } else {
        process.env.TYPEORM_SYNCHRONIZE = value;
      }

      expect(createTypeOrmConfig().synchronize).toBe(false);
    }
  });

  it('runs migrations by default', () => {
    delete process.env.TYPEORM_MIGRATIONS_RUN;

    expect(createTypeOrmConfig().migrationsRun).toBe(true);
  });

  it('lets migrations be disabled explicitly', () => {
    process.env.TYPEORM_MIGRATIONS_RUN = 'false';

    expect(createTypeOrmConfig().migrationsRun).toBe(false);
  });

  it('does not derive migrationsRun from TYPEORM_SYNCHRONIZE any more', () => {
    process.env.TYPEORM_SYNCHRONIZE = 'true';
    delete process.env.TYPEORM_MIGRATIONS_RUN;

    expect(createTypeOrmConfig().migrationsRun).toBe(true);
  });
});
