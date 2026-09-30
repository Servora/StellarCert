import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';
import { LoggingService } from '../logging/logging.service';

@Injectable()
export class StellarService {
  private server: any;
  private networkPassphrase: string;

  constructor(
    private configService: ConfigService,
    private readonly logger: LoggingService,
  ) {
    this.networkPassphrase =
      configService.get<string>('STELLAR_NETWORK') === 'testnet'
        ? StellarSdk.Networks.TESTNET
        : StellarSdk.Networks.PUBLIC;

    this.server = new StellarSdk.Horizon.Server(
      configService.get<string>('STELLAR_HORIZON_URL') ||
        'https://horizon-testnet.stellar.org',
    );
  }

  /**
   * Verify if a transaction exists on the blockchain
   */
  async verifyTransaction(txHash: string): Promise<boolean> {
    try {
      const transaction = await this.server
        .transactions()
        .transaction(txHash)
        .call();
      return !!transaction;
    } catch (error) {
      this.logger.error(
        `Transaction verification failed for hash: ${txHash}`,
        error,
      );
      return false;
    }
  }

  /**
   * Verify if an account exists on the blockchain
   */
  async verifyAccount(accountId: string): Promise<boolean> {
    try {
      const account = await this.server.accounts().accountId(accountId).call();
      return !!account;
    } catch (error) {
      this.logger.error(`Account verification failed for: ${accountId}`, error);
      return false;
    }
  }

  /**
   * Get Stellar public key from secret key
   */
  static getPublicKeyFromSecret(secretKey: string): string {
    const keypair = StellarSdk.Keypair.fromSecret(secretKey);
    return keypair.publicKey();
  }

  getKeypairFromPublicKey(publicKey: string): StellarSdk.Keypair {
    return StellarSdk.Keypair.fromPublicKey(publicKey);
  }

  /**
   * Verify if a public key is valid
   */
  static isValidPublicKey(publicKey: string): boolean {
    try {
      StellarSdk.StrKey.decodeEd25519PublicKey(publicKey);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Verify if a secret key is valid
   */
  static isValidSecretKey(secretKey: string): boolean {
    try {
      StellarSdk.Keypair.fromSecret(secretKey);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check Stellar network health
   */
  async checkNetworkHealth(): Promise<boolean> {
    try {
      const ledger = await this.server.ledgers().limit(1).call();
      return !!ledger && ledger.records && ledger.records.length > 0;
    } catch (error) {
      this.logger.error('Stellar network health check failed', error);
      return false;
    }
  }

  /**
   * Get current network information
   */
  getNetworkInfo(): { network: string; horizon: string } {
    return {
      network: this.configService.get<string>('STELLAR_NETWORK') || 'testnet',
      horizon:
        this.configService.get<string>('STELLAR_HORIZON_URL') ||
        'https://horizon-testnet.stellar.org',
    };
  }
}
