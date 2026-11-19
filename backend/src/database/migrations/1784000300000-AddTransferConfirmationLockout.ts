import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the confirmation-code lockout to certificate transfers.
 *
 * Approving a transfer used to be gated by a six character confirmation code
 * alone, with no limit on how often it could be guessed. The transfer now
 * counts the wrong codes it receives and is locked once the maximum number of
 * attempts is reached, which needs two new columns on
 * `certificate_transfers`:
 *
 * - `failedAttempts` counts the confirmation codes that did not match.
 * - `lockedAt` records when the transfer was locked.
 *
 * The locked state is a new label on the `certificate_transfers_status_enum`
 * type. `ALTER TYPE ... ADD VALUE` cannot run inside a transaction on
 * PostgreSQL versions older than 12, so this migration opts out of the
 * implicit migration transaction.
 */
export class AddTransferConfirmationLockout1784000300000 implements MigrationInterface {
  name = 'AddTransferConfirmationLockout1784000300000';

  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "certificate_transfers_status_enum" ADD VALUE IF NOT EXISTS 'locked'`,
    );
    await queryRunner.query(
      `ALTER TABLE "certificate_transfers" ADD COLUMN IF NOT EXISTS "failedAttempts" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "certificate_transfers" ADD COLUMN IF NOT EXISTS "lockedAt" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "certificate_transfers" DROP COLUMN IF EXISTS "failedAttempts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "certificate_transfers" DROP COLUMN IF EXISTS "lockedAt"`,
    );
    // PostgreSQL cannot remove a single label from an existing enum type, so
    // the 'locked' label stays behind. Rows that are no longer locked simply
    // never use it again.
  }
}
