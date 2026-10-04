import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the unique constraints and index the entities declare but the schema
 * never got.
 *
 * `Certificate.verificationCode` is `@Column({ unique: true })` and
 * `CertificateTransfer.confirmationCode` likewise, but no migration created
 * either constraint. The consequences are real rather than cosmetic:
 *
 * - `GET /certificates/verify/:code` is the public verification route. Without
 *   a unique constraint nothing stops two certificates sharing a code, and the
 *   lookup would then return whichever row Postgres happened to reach first.
 * - `generateConfirmationCode` picks a random code and retries while one
 *   already exists. That check is read-then-write, so without a unique index
 *   two concurrent transfers can settle on the same code; the constraint is
 *   what actually prevents it.
 * - The same public verification route had no index on the column it filters
 *   by, so every verification was a sequential scan over the whole table.
 *
 * Duplicates are resolved before each constraint is added rather than letting
 * the migration fail on existing data: verification codes are regenerated,
 * and duplicate confirmation codes are cleared (they are short-lived and the
 * transfer flow reissues them).
 */
export class AddVerificationAndConfirmationCodeConstraints1783000100000 implements MigrationInterface {
  name = 'AddVerificationAndConfirmationCodeConstraints1783000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Regenerate any duplicate verification codes, keeping the oldest row.
    await queryRunner.query(`
      UPDATE "certificates" c
      SET "verificationCode" = upper(substr(md5(random()::text || c.id::text), 1, 12))
      WHERE c.ctid IN (
        SELECT ctid FROM (
          SELECT ctid, row_number() OVER (
            PARTITION BY "verificationCode" ORDER BY "issuedAt"
          ) AS rn
          FROM "certificates" WHERE "verificationCode" IS NOT NULL
        ) ranked WHERE ranked.rn > 1
      )
    `);

    await queryRunner.query(`
      UPDATE "certificate_transfers" t
      SET "confirmationCode" = NULL
      WHERE t.ctid IN (
        SELECT ctid FROM (
          SELECT ctid, row_number() OVER (
            PARTITION BY "confirmationCode" ORDER BY "initiatedAt"
          ) AS rn
          FROM "certificate_transfers" WHERE "confirmationCode" IS NOT NULL
        ) ranked WHERE ranked.rn > 1
      )
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'UQ_65cf9131ed989c355118efd824f'
        ) THEN
          ALTER TABLE "certificates"
            ADD CONSTRAINT "UQ_65cf9131ed989c355118efd824f" UNIQUE ("verificationCode");
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'UQ_3a99600c4d770fe9c7c8ad87552'
        ) THEN
          ALTER TABLE "certificate_transfers"
            ADD CONSTRAINT "UQ_3a99600c4d770fe9c7c8ad87552" UNIQUE ("confirmationCode");
        END IF;
      END $$;
    `);

    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_65cf9131ed989c355118efd824" ON "certificates" ("verificationCode")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_65cf9131ed989c355118efd824"',
    );
    await queryRunner.query(
      'ALTER TABLE "certificate_transfers" DROP CONSTRAINT IF EXISTS "UQ_3a99600c4d770fe9c7c8ad87552"',
    );
    await queryRunner.query(
      'ALTER TABLE "certificates" DROP CONSTRAINT IF EXISTS "UQ_65cf9131ed989c355118efd824f"',
    );
  }
}
