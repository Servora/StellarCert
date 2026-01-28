import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';
import { DatabaseHealthIndicator } from './indicators/database.health';
import { StellarHealthIndicator } from './indicators/stellar.health';
import { MetricsService } from '../../common/monitoring/metrics.service';

import { StellarModule } from '../stellar/stellar.module';

@Module({
  imports: [TerminusModule, StellarModule],
  controllers: [HealthController, MetricsController],
  providers: [DatabaseHealthIndicator, StellarHealthIndicator, MetricsService],
  exports: [MetricsService],
})
export class HealthModule { }
