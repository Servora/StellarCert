import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The `AuthSession` entity declares `refreshTokenHash` as `@Index({ unique:
 * true })`, but the migration that created `auth_sessions` only ever added
 * a plain (non-unique) index. With `synchronize: false`, that mismatch
 * between the entity's metadata and the real schema never actually
 * enforced uniqueness - this migration makes the index match what the
 * entity has always claimed.
 */
export class MakeAuthSessionRefreshTokenHashUnique1787000000000 implements MigrationInterface {
  name = 'MakeAuthSessionRefreshTokenHashUnique1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_auth_sessions_refreshTokenHash"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_auth_sessions_refreshTokenHash" ON "auth_sessions" ("refreshTokenHash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_auth_sessions_refreshTokenHash"`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_auth_sessions_refreshTokenHash" ON "auth_sessions" ("refreshTokenHash")`,
    );
  }
}
