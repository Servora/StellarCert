import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { StellarService } from '../../../common/services/stellar.service';
import { LoggingService } from '../../../common/logging/logging.service';

@Injectable()
export class StellarHealthIndicator {
  constructor(
    private readonly stellarService: StellarService,
    private readonly logger: LoggingService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('stellar');
    try {
      // Verify Stellar network connectivity by checking a known ledger
      const isConnected = await this.stellarService.checkNetworkHealth();

      if (!isConnected) {
        throw new Error('Unable to connect to Stellar network');
      }

      this.logger.debug('Stellar network health check passed');

      return indicator.up({
        message: 'Stellar network is reachable',
        network: this.stellarService.getNetworkInfo(),
      });
    } catch (error) {
      this.logger.error('Stellar health check failed', error);
      return indicator.down({
        message: error.message || 'Stellar network is unavailable',
      });
    }
  }
}
