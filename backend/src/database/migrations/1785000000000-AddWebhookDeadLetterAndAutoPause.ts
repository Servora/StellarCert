import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebhookDeadLetterAndAutoPause1785000000000
  implements MigrationInterface
{
  name = 'AddWebhookDeadLetterAndAutoPause1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "webhook_subscriptions" ADD COLUMN IF NOT EXISTS "consecutiveFailures" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_subscriptions" ADD COLUMN IF NOT EXISTS "pausedAt" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_subscriptions" ADD COLUMN IF NOT EXISTS "pausedReason" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_logs" ADD COLUMN IF NOT EXISTS "isDeadLetter" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_logs" ADD COLUMN IF NOT EXISTS "deadLetterReason" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "webhook_logs" DROP COLUMN IF EXISTS "deadLetterReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_logs" DROP COLUMN IF EXISTS "isDeadLetter"`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_subscriptions" DROP COLUMN IF EXISTS "pausedReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_subscriptions" DROP COLUMN IF EXISTS "pausedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_subscriptions" DROP COLUMN IF EXISTS "consecutiveFailures"`,
    );
  }
}
