import { TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * The application reads the schema; it never changes it (#956).
 *
 * `synchronize` is hard-coded off rather than driven by an environment flag.
 * It is the only step TypeORM runs during `initialize()` that issues queries
 * **concurrently on a single pooled client**: the schema comparison in
 * `PostgresQueryRunner.getTables` fans out over every column with nested
 * `Promise.all` calls, so several `client.query()` calls — the enum-label
 * lookups below — end up in flight on one connection. That is what makes `pg`
 * emit
 *
 *   DeprecationWarning: Calling client.query() when the client is already
 *   executing a query is deprecated and will be removed in pg@9.0
 *
 * during boot, and it becomes a hard error in `pg@9`. Reproduced with the app
 * itself against a populated database; the trace with `synchronize` on is
 *
 *   at Client.query (pg/lib/client.js:762:7)
 *   at PostgresQueryRunner.query (typeorm/driver/postgres/PostgresQueryRunner.js:181:50)
 *   at async PostgresQueryRunner.getUserDefinedTypeName (…PostgresQueryRunner.js:2618:24)
 *   at async Promise.all (index 14)
 *   at async Promise.all (index 3)
 *   at async PostgresQueryRunner.getTables (…BaseQueryRunner.js:98:29)
 *   at async RdbmsSchemaBuilder.build (…RdbmsSchemaBuilder.js:64:13)
 *
 * and the same boot with `synchronize` off logs no warning at all.
 * `MIGRATION_STRATEGY.md` already requires
 * `synchronize: false` in every environment — this makes the code say so.
 *
 * Schema changes belong to the migrations (see `migrationsRun` below and
 * `src/database/data-source.ts`), which TypeORM executes one statement at a
 * time.
 */
export const typeOrmConfig: TypeOrmModuleOptions = {
  type: (process.env.DB_TYPE as any) || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'stellarwave_user',
  password: process.env.DB_PASSWORD || 'stellarwave_password',
  database: process.env.DB_NAME || 'stellarwave',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: false,
  logging: process.env.NODE_ENV !== 'production',
  autoLoadEntities: true,
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],
  migrationsRun: true,
};

/**
 * Configuration that contradicts the documented migration strategy.
 *
 * `TYPEORM_SYNCHRONIZE=true` used to enable `synchronize` (the concurrent
 * schema step described above) and, as a side effect, disable `migrationsRun`.
 * It is no longer honoured — a project relying on it ends up with neither
 * strategy applied, which is worse than a clear message — but it must not be
 * ignored silently, so `main.ts` logs each entry before bootstrapping.
 */
export function migrationStrategyWarnings(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const warnings: string[] = [];

  if ((env.TYPEORM_SYNCHRONIZE || '').trim().toLowerCase() === 'true') {
    warnings.push(
      'TYPEORM_SYNCHRONIZE=true is ignored: this application never synchronizes ' +
        'the schema, because TypeORM runs that step with concurrent queries on a ' +
        'single pooled client (#956). Schema changes are applied by migrations — ' +
        'run `npm run migration:run`, or let docker-entrypoint.sh do it on deploy. ' +
        'See MIGRATION_STRATEGY.md.',
    );
  }

  return warnings;
}
