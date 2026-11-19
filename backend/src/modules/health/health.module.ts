import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';
import { RateLimitController } from './rate-limit.controller';
import { DatabaseHealthIndicator } from './indicators/database.health';
import { StellarHealthIndicator } from './indicators/stellar.health';
import { RedisHealthIndicator } from './indicators/redis.health';
import { CommonModule } from '../../common/common.module';
import { ConfigModule } from '@nestjs/config';
import { StellarService } from '../../common/services/stellar.service';
import { IpRateLimitGuard } from '../../common/guards/ip-rate-limit.guard';

@Module({
  imports: [
    TerminusModule,
    // Provides (and exports) the single MetricsService instance.
    CommonModule,
    ConfigModule,
    // RedisHealthIndicator injects @InjectQueue('stellar-email-queue'); register
    // the queue here so its provider (BullQueue_stellar-email-queue) resolves.
    BullModule.registerQueue({ name: 'stellar-email-queue' }),
  ],
  controllers: [HealthController, MetricsController, RateLimitController],
  providers: [
    DatabaseHealthIndicator,
    StellarHealthIndicator,
    RedisHealthIndicator,
    StellarService,
    IpRateLimitGuard,
  ],
})
export class HealthModule {}
