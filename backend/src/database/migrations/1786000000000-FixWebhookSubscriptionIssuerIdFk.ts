import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `webhook_subscriptions.issuerId` has always held the authenticated user's
 * id (every write site populates it from `@CurrentUser('id')`), but the FK
 * added in the initial schema pointed at `issuers` - an unrelated API-key
 * tenant table that normally has no rows. Every POST /webhooks therefore
 * failed with a foreign key violation. This points the FK at `users`,
 * matching what is actually stored.
 */
export class FixWebhookSubscriptionIssuerIdFk1786000000000 implements MigrationInterface {
  name = 'FixWebhookSubscriptionIssuerIdFk1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "webhook_subscriptions" DROP CONSTRAINT IF EXISTS "FK_webhook_subscriptions_issuerId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "FK_webhook_subscriptions_issuerId" FOREIGN KEY ("issuerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "webhook_subscriptions" DROP CONSTRAINT IF EXISTS "FK_webhook_subscriptions_issuerId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "FK_webhook_subscriptions_issuerId" FOREIGN KEY ("issuerId") REFERENCES "issuers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
