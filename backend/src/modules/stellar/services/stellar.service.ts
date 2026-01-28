import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Networks,
  Memo,
  Asset,
  Operation,
  TimeoutInfinite,
} from '@stellar/stellar-sdk';
import axios from 'axios';

export interface CreateAccountResult {
  publicKey: string;
  secretKey: string;
  funded?: boolean;
}

export interface TransactionResult {
  hash: string;
  successful: boolean;
  ledger?: number;
  error?: string;
}

@Injectable()
export class StellarService implements OnModuleInit {
  private readonly logger = new Logger(StellarService.name);
  private server: Horizon.Server;
  private networkPassphrase: string;
  private issuerKeypair: Keypair;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.initializeStellar();
  }

  private initializeStellar() {
    const horizonUrl = this.configService.get<string>('STELLAR_HORIZON_URL');
    const network = this.configService.get<string>('STELLAR_NETWORK');
    const issuerSecret = this.configService.get<string>('STELLAR_ISSUER_SECRET_KEY');

    if (!horizonUrl || !network || !issuerSecret) {
      this.logger.warn('Stellar configuration missing. StellarService may not function correctly.');
      return;
    }

    this.server = new Horizon.Server(horizonUrl, { allowHttp: horizonUrl.includes('localhost') });
    this.networkPassphrase = network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
    
    try {
        this.issuerKeypair = Keypair.fromSecret(issuerSecret);
    } catch (e) {
        this.logger.error('Invalid Stellar Issuer Secret Key provided.');
    }

    this.logger.log(`StellarService initialized on ${network}`);
  }

  async createAccount(): Promise<CreateAccountResult> {
    const keypair = Keypair.random();
    const publicKey = keypair.publicKey();
    const secretKey = keypair.secret();
    let funded = false;

    if (this.networkPassphrase === Networks.TESTNET) {
      try {
        this.logger.log(`Funding new account ${publicKey} via Friendbot...`);
        await axios.get(`https://friendbot.stellar.org?addr=${publicKey}`);
        funded = true;
        this.logger.log(`Account ${publicKey} funded successfully.`);
      } catch (error) {
        this.logger.error(`Failed to fund account via Friendbot: ${error.message}`);
      }
    }

    return { publicKey, secretKey, funded };
  }

  async getAccountInfo(publicKey: string) {
    try {
      return await this.server.loadAccount(publicKey);
    } catch (error) {
      this.logger.error(`Failed to load account ${publicKey}: ${error.message}`);
      throw error;
    }
  }

  async createCertificateTransaction(
    destination: string,
    memoText: string,
    assetCode?: string
  ): Promise<TransactionResult> {
    try {
      if (!this.issuerKeypair) {
        throw new Error('Issuer keypair not configured.');
      }

      const sourceAccount = await this.server.loadAccount(this.issuerKeypair.publicKey());

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: (await this.server.fetchBaseFee()).toString(),
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          Operation.payment({
            destination: destination,
            asset: Asset.native(),
            amount: '1',
          })
        )
        .addMemo(Memo.text(memoText))
        .setTimeout(TimeoutInfinite)
        .build();

      transaction.sign(this.issuerKeypair);

      const result = await this.server.submitTransaction(transaction);
      
      this.logger.log(`Transaction submitted with hash: ${result.hash}`);

      return {
        hash: result.hash,
        successful: true,
        ledger: result.ledger,
      };
    } catch (error) {
      this.logger.error(`Transaction failed: ${error.message}`, error.response?.data);
      return {
        hash: '',
        successful: false,
        error: error.message || 'Transaction failed',
      };
    }
  }

  async verifyTransaction(hash: string): Promise<TransactionResult> {
    try {
      const tx = await this.server.transactions().transaction(hash).call();
      return {
        hash: tx.hash,
        successful: true,
        ledger: tx.ledger_attr,
      };
    } catch (error) {
      this.logger.error(`Failed to verify transaction ${hash}: ${error.message}`);
      return {
        hash,
        successful: false,
        error: error.message,
      };
    }
  }

  async checkNetworkHealth(): Promise<boolean> {
    try {
      const ledger = await this.server.ledgers().limit(1).call();
      return !!ledger && ledger.records && ledger.records.length > 0;
    } catch (error) {
      this.logger.error('Stellar network health check failed', error);
      return false;
    }
  }

  getNetworkInfo(): { network: string; horizon: string } {
    return {
      network: this.configService.get<string>('STELLAR_NETWORK') || 'testnet',
      horizon: this.configService.get<string>('STELLAR_HORIZON_URL') || 'https://horizon-testnet.stellar.org',
    };
  }
}
