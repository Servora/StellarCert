import * as fs from 'fs';
import * as path from 'path';

/**
 * Regression tests for the schema policy behind #956.
 *
 * The `pg` deprecation warning seen at startup came from TypeORM's schema
 * comparison, which is the only step TypeORM runs during `initialize()` that
 * issues queries concurrently on a single pooled client
 * (`PostgresQueryRunner.getTables` fans out over every column with nested
 * `Promise.all` calls). That step is `synchronize`, so the invariant worth
 * pinning is: this application never synchronizes, whatever the environment
 * says.
 */

type ConfigModule = typeof import('./typeorm.config');
type DataSourceModule = typeof import('../database/data-source');

const ORIGINAL_FLAG = process.env.TYPEORM_SYNCHRONIZE;

/** Re-evaluates the module so it reads the environment under test. */
function loadConfig(flag?: string): ConfigModule {
  if (flag === undefined) {
    delete process.env.TYPEORM_SYNCHRONIZE;
  } else {
    process.env.TYPEORM_SYNCHRONIZE = flag;
  }

  let loaded!: ConfigModule;
  jest.isolateModules(() => {
    loaded = require('./typeorm.config') as ConfigModule;
  });
  return loaded;
}

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) {
    delete process.env.TYPEORM_SYNCHRONIZE;
  } else {
    process.env.TYPEORM_SYNCHRONIZE = ORIGINAL_FLAG;
  }
});

describe('typeOrmConfig never changes the schema at boot (#956)', () => {
  it('does not synchronize with a clean environment', () => {
    const { typeOrmConfig } = loadConfig();

    expect(typeOrmConfig.synchronize).toBe(false);
    expect(typeOrmConfig.dropSchema).toBeFalsy();
    // Migrations are the only schema step the app performs.
    expect(typeOrmConfig.migrationsRun).toBe(true);
  });

  it('does not synchronize when TYPEORM_SYNCHRONIZE=true', () => {
    const { typeOrmConfig } = loadConfig('true');

    expect(typeOrmConfig.synchronize).toBe(false);
    expect(typeOrmConfig.dropSchema).toBeFalsy();
    // The ignored flag must not take migrations down with it: an app that
    // neither synchronizes nor migrates can never provision a database.
    expect(typeOrmConfig.migrationsRun).not.toBe(false);
  });
});

describe('migrationStrategyWarnings', () => {
  it('is silent when the flag is unset or false', () => {
    const { migrationStrategyWarnings } = loadConfig();

    expect(migrationStrategyWarnings({})).toEqual([]);
    expect(migrationStrategyWarnings({ TYPEORM_SYNCHRONIZE: 'false' })).toEqual(
      [],
    );
  });

  it('explains the ignored flag, case and whitespace insensitively', () => {
    const { migrationStrategyWarnings } = loadConfig();

    const warnings = migrationStrategyWarnings({
      TYPEORM_SYNCHRONIZE: ' TRUE ',
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('TYPEORM_SYNCHRONIZE');
    expect(warnings[0]).toContain('#956');
    expect(warnings[0]).toContain('npm run migration:run');
  });
});

describe('the CLI DataSource still owns the migrations', () => {
  function loadDataSource(): DataSourceModule {
    let loaded!: DataSourceModule;
    jest.isolateModules(() => {
      loaded = require('../database/data-source') as DataSourceModule;
    });
    return loaded;
  }

  it('points at the committed migrations directory', () => {
    const { AppDataSource } = loadDataSource();
    const patterns =
      (AppDataSource.options as { migrations?: string[] }).migrations ?? [];

    expect(patterns.length).toBeGreaterThan(0);

    // A glob pointing somewhere that does not exist means `migration:run`
    // silently applies nothing (or fails outright), so the directory it names
    // must exist and be this project's migrations directory.
    const migrationsDir = path.dirname(patterns[0]);
    expect(fs.existsSync(migrationsDir)).toBe(true);
    expect(path.resolve(migrationsDir)).toBe(
      path.resolve(__dirname, '..', 'database', 'migrations'),
    );

    const extensions = /\.\{(.*)\}$/.test(patterns[0])
      ? (RegExp.$1 ?? '').split(',').map((ext) => `.${ext}`)
      : [path.extname(patterns[0])];

    const matching = fs
      .readdirSync(migrationsDir)
      .filter((file) => extensions.some((ext) => file.endsWith(ext)));

    expect(matching.length).toBeGreaterThan(0);
  });
});
