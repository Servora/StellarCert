import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `secretHash` column to `webhook_subscriptions`.
 *
 * `WebhookSubscription` has declared `secretHash` for some time, but no
 * migration ever created the column. TypeORM therefore selects it on every
 * subscription query, and Postgres answers `column sub.secretHash does not
 * exist`.
 *
 * `WebhooksService.triggerEvent` runs such a query, and certificate issuance
 * triggers an event — so issuing a certificate failed with a 500 on a schema
 * built from migrations. It only worked where the schema had been created by
 * `synchronize`, which quietly added the column from the entity.
 *
 * Nullable, matching `@Column({ nullable: true })`: existing rows have no
 * hash to backfill, and the column is an integrity check beside `secret`,
 * not a replacement for it.
 */
export class AddWebhookSubscriptionSecretHash1783000000000 implements MigrationInterface {
  name = 'AddWebhookSubscriptionSecretHash1783000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "webhook_subscriptions" ADD COLUMN IF NOT EXISTS "secretHash" character varying',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "webhook_subscriptions" DROP COLUMN IF EXISTS "secretHash"',
    );
  }
}
