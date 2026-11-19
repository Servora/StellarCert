/**
 * TypeORM DataSource for the CLI (migration:run, migration:generate, etc.)
 *
 * This file is intentionally separate from the NestJS module config so that
 * the TypeORM CLI can bootstrap a DataSource without loading the full NestJS
 * application.
 *
 * Usage:
 *   npm run migration:run      (typeorm-ts-node-commonjs, from src/)
 *   node node_modules/.bin/typeorm migration:run -d dist/database/data-source.js   (compiled, as docker-entrypoint.sh does)
 *   npm run migration:revert
 *
 * Exactly one DataSource export: the TypeORM CLI rejects a file that exports
 * the same instance both as a named export and as default ("must contain only
 * one export of DataSource instance").
 */
import { DataSource } from 'typeorm';
import * as path from 'path';
import { databaseSslOptions } from '../config/database-ssl.config';

// When running via the CLI the source is compiled JS under dist/.
// Migrations are therefore loaded from dist/database/migrations/*.js
// When running via ts-node (e.g. migration:run with src/database/data-source.ts)
// the source is TypeScript and migrations are loaded from src/database/migrations/*.ts.
const isCompiledJs = __filename.endsWith('.js');

export const AppDataSource = new DataSource({
  type: (process.env.DB_TYPE as any) || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'stellarwave_user',
  password: process.env.DB_PASSWORD || 'stellarwave_password',
  database: process.env.DB_NAME || 'stellarwave',
  ...databaseSslOptions(),
  // Entities and migrations use the compiled JS paths in production;
  // fall back to TS sources when running with ts-node locally.
  entities: isCompiledJs
    ? [path.join(__dirname, '../**/*.entity.js')]
    : [path.join(__dirname, '../**/*.entity.ts')],
  migrations: isCompiledJs
    ? [path.join(__dirname, './migrations/*.js')]
    : [path.join(__dirname, './migrations/*.ts')],
  synchronize: false,
  // Run each migration in its own transaction rather than wrapping the whole
  // run in one. The default ("all") makes TypeORM reject any migration that
  // sets `transaction = false`, and AddFrozenCertificateWebhookEvents must
  // opt out because `ALTER TYPE ... ADD VALUE` cannot run inside a
  // transaction on PostgreSQL before 12.
  migrationsTransactionMode: 'each',
  logging: process.env.NODE_ENV !== 'production',
});
