import { Module, forwardRef, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksProcessor } from './webhooks.processor';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { WebhookLog } from './entities/webhook-log.entity';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

// Retry delays: 1min, 5min, 30min, 2hr, 12hr
const WEBHOOK_RETRY_DELAYS = [
  60_000, 300_000, 1_800_000, 7_200_000, 43_200_000,
];

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookSubscription, WebhookLog]),
    BullModule.registerQueue({
      name: 'webhooks',
      settings: {
        backoffStrategies: {
          webhookRetry: (attemptsMade: number) =>
            WEBHOOK_RETRY_DELAYS[
              Math.min(attemptsMade, WEBHOOK_RETRY_DELAYS.length - 1)
            ],
        },
      },
    }),
    BullBoardModule.forFeature({
      name: 'webhooks',
      adapter: BullAdapter,
    }),
    forwardRef(() => AuthModule),
    NotificationsModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhooksProcessor],
  exports: [WebhooksService],
})
export class WebhooksModule {}
