import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * #1144 index audit_logs.timestamp
 * #1145 index certificates.expiresAt
 * #1184 auth_sessions table + users.tokenVersion
 */
export class AuditTimestampCertExpiryAndSessions1784000000000 implements MigrationInterface {
  name = 'AuditTimestampCertExpiryAndSessions1784000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_timestamp" ON "audit_logs" ("timestamp")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_certificates_expires_at" ON "certificates" ("expiresAt")`,
    );
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "tokenVersion" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "auth_sessions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "refreshTokenHash" varchar NOT NULL,
        "device" varchar,
        "ipAddress" varchar,
        "userAgent" varchar,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "lastUsedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "revokedAt" TIMESTAMPTZ,
        CONSTRAINT "FK_auth_sessions_user"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_auth_sessions_userId" ON "auth_sessions" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_auth_sessions_refreshTokenHash" ON "auth_sessions" ("refreshTokenHash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "auth_sessions"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "tokenVersion"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_certificates_expires_at"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_timestamp"`);
  }
}
