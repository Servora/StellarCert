import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { StellarService } from '../../stellar/services/stellar.service';

@Injectable()
export class StellarHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(StellarHealthIndicator.name);

  constructor(private readonly stellarService: StellarService) {
    super();
  }

  async isHealthy(): Promise<HealthIndicatorResult> {
    try {
      // Verify Stellar network connectivity by checking a known ledger
      const isConnected = await this.stellarService.checkNetworkHealth();

      if (!isConnected) {
        throw new Error('Unable to connect to Stellar network');
      }

      this.logger.debug('Stellar network health check passed');

      return this.getStatus('stellar', true, {
        message: 'Stellar network is reachable',
        network: this.stellarService.getNetworkInfo(),
      });
    } catch (error) {
      this.logger.error('Stellar health check failed', error);
      throw new HealthCheckError(
        'Stellar network check failed',
        this.getStatus('stellar', false, {
          message: error.message || 'Stellar network is unavailable',
        }),
      );
    }
  }
}
