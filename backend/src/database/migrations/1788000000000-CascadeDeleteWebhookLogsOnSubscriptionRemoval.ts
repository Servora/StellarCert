import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `webhook_logs.subscriptionId` had no ON DELETE behavior, so
 * `DELETE /webhooks/:id` 500'd with a foreign key violation on any
 * subscription that had ever recorded a delivery attempt - meaning a
 * subscription couldn't be deleted once it had any history at all. Log
 * rows have no independent value once their subscription is gone, so this
 * cascades the delete instead of blocking it.
 */
export class CascadeDeleteWebhookLogsOnSubscriptionRemoval1788000000000 implements MigrationInterface {
  name = 'CascadeDeleteWebhookLogsOnSubscriptionRemoval1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "webhook_logs" DROP CONSTRAINT IF EXISTS "FK_webhook_logs_subscriptionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_logs" ADD CONSTRAINT "FK_webhook_logs_subscriptionId" FOREIGN KEY ("subscriptionId") REFERENCES "webhook_subscriptions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "webhook_logs" DROP CONSTRAINT IF EXISTS "FK_webhook_logs_subscriptionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_logs" ADD CONSTRAINT "FK_webhook_logs_subscriptionId" FOREIGN KEY ("subscriptionId") REFERENCES "webhook_subscriptions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
