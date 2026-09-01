import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Contract,
  TransactionBuilder,
  Networks,
  Keypair,
  Address,
  xdr,
  nativeToScVal,
  scValToNative,
  StrKey,
} from '@stellar/stellar-sdk';
import { LoggingService } from '../../../common/logging/logging.service';

export interface ContractDeploymentResult {
  contractId: string;
  transactionHash: string;
  successful: boolean;
}

export interface CertificateContractData {
  id: string;
  issuer: string;
  owner: string;
  status: string;
  metadataUri: string;
  issuedAt: number;
  expiresAt?: number;
}

export interface MultisigRequest {
  id: string;
  issuer: string;
  recipient: string;
  metadata: string;
  proposer: string;
  approvals: string[];
  rejections: string[];
  createdAt: number;
  expiresAt: number;
  status: string;
}

@Injectable()
export class SorobanService implements OnModuleInit {
  private server: any;
  private networkPassphrase: string;
  private adminKeypair: Keypair;
  private certificateContractId: string;
  private multisigContractId: string;
  private crlContractId: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggingService,
  ) {}

  onModuleInit() {
    this.initializeSoroban();
  }

  private initializeSoroban() {
    const rpcUrl = this.configService.get<string>('SOROBAN_RPC_URL');
    const network = this.configService.get<string>('STELLAR_NETWORK');
    const adminSecret = this.configService.get<string>('SOROBAN_ADMIN_SECRET');
    this.certificateContractId =
      this.configService.get<string>('CERTIFICATE_CONTRACT_ID') || '';
    this.multisigContractId =
      this.configService.get<string>('MULTISIG_CONTRACT_ID') || '';
    this.crlContractId =
      this.configService.get<string>('CRL_CONTRACT_ID') || '';

    if (!rpcUrl || !network || !adminSecret) {
      this.logger.warn(
        'Soroban configuration missing. SorobanService may not function correctly.',
      );
      return;
    }

    this.server = new (require('@stellar/stellar-sdk').rpc.Server)(rpcUrl, {
      allowHttp: rpcUrl.includes('localhost'),
    });
    this.networkPassphrase =
      network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;

    try {
      this.adminKeypair = Keypair.fromSecret(adminSecret);
    } catch (e) {
      this.logger.error('Invalid Soroban Admin Secret Key provided.');
    }

    this.logger.log(`SorobanService initialized on ${network}`);
  }

  /**
   * Deploy a new contract instance
   */
  async deployContract(wasmHash: string): Promise<ContractDeploymentResult> {
    try {
      if (!this.adminKeypair) {
        throw new Error('Admin keypair not configured.');
      }

      const sourceAccount = await this.server.getAccount(
        this.adminKeypair.publicKey(),
      );

      const contract = new Contract(wasmHash);

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          (contract as any).deploy({
            wasmHash: Buffer.from(wasmHash, 'hex'),
          }),
        )
        .setTimeout(30)
        .build();

      transaction.sign(this.adminKeypair);

      const result = await this.server.sendTransaction(transaction);

      if (result.status !== 'PENDING') {
        throw new Error(`Transaction failed: ${result.status}`);
      }

      // Poll until the ledger confirms the transaction
      const txResponse = await this.pollTransaction(result.hash);

      if (txResponse.status !== 'SUCCESS') {
        throw new Error(`Transaction failed: ${txResponse.status}`);
      }

      const contractId =
        txResponse.returnValue?._value?._value?.toString('hex');

      return {
        contractId: contractId || '',
        transactionHash: result.hash,
        successful: true,
      };
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Contract deployment failed: ${message}`);
      return {
        contractId: '',
        transactionHash: '',
        successful: false,
      };
    }
  }

  /**
   * Initialize the certificate contract
   */
  async initializeCertificateContract(adminAddress: string): Promise<boolean> {
    try {
      if (!this.certificateContractId) {
        throw new Error('Certificate contract ID not configured.');
      }

      const contract = new Contract(this.certificateContractId);
      const admin = Address.fromString(adminAddress);

      const sourceAccount = await this.server.getAccount(
        this.adminKeypair.publicKey(),
      );

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('initialize', nativeToScVal(admin)))
        .setTimeout(30)
        .build();

      transaction.sign(this.adminKeypair);

      const result = await this.server.sendTransaction(transaction);

      if (result.status !== 'PENDING') {
        throw new Error(`Transaction failed: ${result.status}`);
      }

      // Poll until the ledger confirms the transaction
      const txResponse = await this.pollTransaction(result.hash);

      return txResponse.status === 'SUCCESS';
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Certificate contract initialization failed: ${message}`,
      );
      return false;
    }
  }

  /**
   * Add an authorized issuer to the certificate contract
   */
  async addIssuer(issuerAddress: string): Promise<boolean> {
    try {
      if (!this.certificateContractId) {
        throw new Error('Certificate contract ID not configured.');
      }

      const contract = new Contract(this.certificateContractId);
      const issuer = Address.fromString(issuerAddress);

      const sourceAccount = await this.server.getAccount(
        this.adminKeypair.publicKey(),
      );

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('add_issuer', nativeToScVal(issuer)))
        .setTimeout(30)
        .build();

      transaction.sign(this.adminKeypair);

      const result = await this.server.sendTransaction(transaction);

      if (result.status !== 'PENDING') {
        throw new Error(`Transaction failed: ${result.status}`);
      }

      // Poll until the ledger confirms the transaction
      const txResponse = await this.pollTransaction(result.hash);

      return txResponse.status === 'SUCCESS';
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Add issuer failed: ${message}`);
      return false;
    }
  }

  /**
   * Issue a certificate on-chain
   */
  async issueCertificate(
    id: string,
    issuerAddress: string,
    ownerAddress: string,
    metadataUri: string,
    expiresAt?: number,
  ): Promise<boolean> {
    try {
      if (!this.certificateContractId) {
        throw new Error('Certificate contract ID not configured.');
      }

      const contract = new Contract(this.certificateContractId);
      const issuer = Address.fromString(issuerAddress);
      const owner = Address.fromString(ownerAddress);

      // Get issuer's keypair for signing (this would need to be passed or retrieved)
      const issuerKeypair = this.getIssuerKeypair(issuerAddress);
      const sourceAccount = await this.server.getAccount(
        issuerKeypair.publicKey(),
      );

      const args = [
        nativeToScVal(id),
        nativeToScVal(issuer),
        nativeToScVal(owner),
        nativeToScVal(metadataUri),
        expiresAt ? nativeToScVal(expiresAt) : nativeToScVal(null),
      ];

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('issue_certificate', ...args))
        .setTimeout(30)
        .build();

      transaction.sign(issuerKeypair);

      const result = await this.server.sendTransaction(transaction);

      if (result.status !== 'PENDING') {
        throw new Error(`Transaction failed: ${result.status}`);
      }

      // Poll until the ledger confirms the transaction
      const txResponse = await this.pollTransaction(result.hash);

      return txResponse.status === 'SUCCESS';
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Certificate issuance failed: ${message}`);
      return false;
    }
  }

  /**
   * Revoke a certificate on-chain
   */
  async revokeCertificate(
    id: string,
    issuerAddress: string,
    reason: string,
  ): Promise<boolean> {
    try {
      if (!this.certificateContractId) {
        throw new Error('Certificate contract ID not configured.');
      }

      const contract = new Contract(this.certificateContractId);

      const issuerKeypair = this.getIssuerKeypair(issuerAddress);
      const sourceAccount = await this.server.getAccount(
        issuerKeypair.publicKey(),
      );

      const args = [nativeToScVal(id), nativeToScVal(reason)];

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('revoke_certificate', ...args))
        .setTimeout(30)
        .build();

      transaction.sign(issuerKeypair);

      const result = await this.server.sendTransaction(transaction);

      if (result.status !== 'PENDING') {
        throw new Error(`Transaction failed: ${result.status}`);
      }

      // Poll until the ledger confirms the transaction
      const txResponse = await this.pollTransaction(result.hash);

      return txResponse.status === 'SUCCESS';
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Certificate revocation failed: ${message}`);
      return false;
    }
  }

  /**
   * Get certificate data from the contract
   */
  async getCertificate(id: string): Promise<CertificateContractData | null> {
    try {
      if (!this.certificateContractId) {
        throw new Error('Certificate contract ID not configured.');
      }

      const contract = new Contract(this.certificateContractId);

      const sourceAccount = await this.server.getAccount(
        this.adminKeypair.publicKey(),
      );

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('get_certificate', nativeToScVal(id)))
        .setTimeout(30)
        .build();

      transaction.sign(this.adminKeypair);

      const result = await this.server.sendTransaction(transaction);

      if (result.status !== 'PENDING') {
        throw new Error(`Transaction failed: ${result.status}`);
      }

      // Poll until the ledger confirms the transaction
      const txResponse = await this.pollTransaction(result.hash);

      if (txResponse.status !== 'SUCCESS' || !txResponse.returnValue) {
        return null;
      }

      const certificateData = scValToNative(txResponse.returnValue);

      return {
        id: certificateData.id,
        issuer: certificateData.issuer.toString(),
        owner: certificateData.owner.toString(),
        status: certificateData.status,
        metadataUri: certificateData.metadata_uri,
        issuedAt: certificateData.issued_at,
        expiresAt: certificateData.expires_at,
      };
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Get certificate failed: ${message}`);
      return null;
    }
  }

  /**
   * Initialize multisig configuration for an issuer
   */
  async initMultisigConfig(
    issuerAddress: string,
    threshold: number,
    signers: string[],
    maxSigners: number,
  ): Promise<boolean> {
    try {
      if (!this.multisigContractId) {
        throw new Error('Multisig contract ID not configured.');
      }

      const contract = new Contract(this.multisigContractId);
      const issuer = Address.fromString(issuerAddress);
      const admin = Address.fromString(this.adminKeypair.publicKey());
      const signerAddresses = signers.map((s) => Address.fromString(s));

      const sourceAccount = await this.server.getAccount(
        this.adminKeypair.publicKey(),
      );

      const args = [
        nativeToScVal(issuer),
        nativeToScVal(threshold),
        nativeToScVal(signerAddresses),
        nativeToScVal(maxSigners),
        nativeToScVal(admin),
      ];

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('init_multisig_config', ...args))
        .setTimeout(30)
        .build();

      transaction.sign(this.adminKeypair);

      const result = await this.server.sendTransaction(transaction);

      if (result.status !== 'PENDING') {
        throw new Error(`Transaction failed: ${result.status}`);
      }

      // Poll until the ledger confirms the transaction
      const txResponse = await this.pollTransaction(result.hash);

      return txResponse.status === 'SUCCESS';
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Multisig config initialization failed: ${message}`);
      return false;
    }
  }

  /**
   * Helper method to get issuer keypair (this would need proper key management)
   */
  private getIssuerKeypair(issuerAddress: string): Keypair {
    // This is a placeholder - in production, you'd have proper key management
    // For now, we'll assume the admin keypair is used for all operations
    return this.adminKeypair;
  }

  /**
   * Poll getTransaction until the transaction leaves the NOT_FOUND / PENDING
   * state, or until the retry limit is exhausted.
   *
   * Soroban transactions are processed asynchronously: a PENDING status from
   * sendTransaction only means the node accepted the submission — the ledger
   * may not have closed yet.  Calling getTransaction immediately after
   * sendTransaction therefore returns NOT_FOUND or PENDING for valid
   * transactions, making a single-shot check unreliable.
   *
   * @param hash       Transaction hash returned by sendTransaction.
   * @param maxRetries Maximum number of polling attempts (default 10).
   * @param delayMs    Milliseconds to wait between attempts (default 1 000).
   * @returns          The final transaction response once it settles.
   * @throws           If the transaction does not settle within the retry
   *                   window or if the node returns an unexpected status.
   */
  private async pollTransaction(
    hash: string,
    maxRetries = 10,
    delayMs = 1000,
  ): Promise<any> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const txResponse = await this.server.getTransaction(hash);

      // SUCCESS or FAILED are terminal states — stop polling.
      if (txResponse.status === 'SUCCESS' || txResponse.status === 'FAILED') {
        return txResponse;
      }

      // NOT_FOUND means the ledger hasn't closed yet; PENDING is the same.
      // Any other unexpected status should surface as an error immediately.
      if (
        txResponse.status !== 'NOT_FOUND' &&
        txResponse.status !== 'PENDING'
      ) {
        throw new Error(
          `Unexpected transaction status on attempt ${attempt}: ${txResponse.status}`,
        );
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new Error(
      `Transaction ${hash} did not settle after ${maxRetries} polling attempts`,
    );
  }

  /**
   * Check if Soroban service is properly configured
   */
  isConfigured(): boolean {
    return !!(this.server && this.adminKeypair && this.certificateContractId);
  }
}
