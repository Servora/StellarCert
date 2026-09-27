import { TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * TypeORM schema synchronisation is permanently disabled (#956).
 *
 * `synchronize: true` runs TypeORM's `RdbmsSchemaBuilder`, which issues its
 * schema statements without awaiting each one on the shared connection. Under
 * `pg >= 8.16` that is reported as:
 *
 *   DeprecationWarning: Calling client.query() when the client is already
 *   executing a query is deprecated and will be removed in pg@9.0.
 *
 * and it becomes a hard error when `pg@9` lands. Migrations are the only
 * supported way to change the schema (see `backend/MIGRATION_STRATEGY.md`),
 * so the flag that could re-enable that code path is not read any more: the
 * old `TYPEORM_SYNCHRONIZE=true` behaviour of turning schema sync on (and
 * migrations off) is gone.
 */
export const SCHEMA_SYNCHRONIZE = false;

/**
 * Builds the NestJS TypeORM options from the current environment.
 *
 * Exposed as a function so tests can assert the configuration for specific
 * environment values instead of relying on the module-level snapshot.
 */
export function createTypeOrmConfig(): TypeOrmModuleOptions {
  return {
    type: (process.env.DB_TYPE as any) || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'stellarwave_user',
    password: process.env.DB_PASSWORD || 'stellarwave_password',
    database: process.env.DB_NAME || 'stellarwave',
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    synchronize: SCHEMA_SYNCHRONIZE,
    logging: process.env.NODE_ENV !== 'production',
    autoLoadEntities: true,
    migrations: [__dirname + '/../migrations/*{.ts,.js}'],
    // Migrations are the only schema path, so they run on boot unless they are
    // explicitly disabled (e.g. when an entrypoint already applied them).
    migrationsRun: process.env.TYPEORM_MIGRATIONS_RUN !== 'false',
  };
}

export const typeOrmConfig: TypeOrmModuleOptions = createTypeOrmConfig();
