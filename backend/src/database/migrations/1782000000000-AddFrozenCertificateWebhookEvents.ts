import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Registers the dedicated certificate freeze/unfreeze webhook events (#1008).
 *
 * Certificate freeze/unfreeze previously reused `certificate.revoked` and
 * `certificate.issued`, so subscribers could not distinguish a temporary hold
 * from a permanent revocation. The new labels must exist on the Postgres enum
 * backing `webhook_subscriptions.events` before a subscription can store them.
 *
 * `ALTER TYPE ... ADD VALUE` cannot run inside a transaction on PostgreSQL
 * versions older than 12, so this migration opts out of the implicit
 * migration transaction.
 */
export class AddFrozenCertificateWebhookEvents1782000000000 implements MigrationInterface {
  name = 'AddFrozenCertificateWebhookEvents1782000000000';

  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "webhook_subscriptions_events_enum" ADD VALUE IF NOT EXISTS 'certificate.frozen'`,
    );
    await queryRunner.query(
      `ALTER TYPE "webhook_subscriptions_events_enum" ADD VALUE IF NOT EXISTS 'certificate.unfrozen'`,
    );
  }

  public async down(): Promise<void> {
    // PostgreSQL cannot remove a single label from an existing enum type, and
    // recreating the type would rewrite every dependent subscription row.
    // Subscriptions that never selected the new events are unaffected, so the
    // rollback is intentionally a no-op.
  }
}
