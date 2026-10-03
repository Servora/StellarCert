import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  rpc,
  TransactionBuilder,
  Networks,
  Contract,
  xdr,
  Address,
  Account,
  scValToNative,
} from '@stellar/stellar-sdk';
import { StellarService } from '../stellar/services/stellar.service';
import { LoggingService } from '../../common/logging/logging.service';

// Enums and interfaces matching the smart contract
export enum RequestStatus {
  Pending = 0,
  Approved = 1,
  Rejected = 2,
  Expired = 3,
  Issued = 4,
}

export enum SignatureAction {
  Approved = 0,
  Rejected = 1,
}

export interface MultisigConfig {
  threshold: number;
  signers: string[];
  max_signers: number;
}

export interface PendingRequest {
  id: string;
  issuer: string;
  recipient: string;
  metadata: string;
  proposer: string;
  approvals: string[];
  rejections: string[];
  rejection_reason?: string;
  created_at: number;
  expires_at: number;
  status: RequestStatus;
}

export interface SignatureResult {
  success: boolean;
  message: string;
  final_status?: RequestStatus;
}

export interface MultisigEvent {
  request_id: string;
  signer: string;
  action: SignatureAction;
  timestamp: number;
}

export interface Pagination {
  page: number;
  limit: number;
}

export interface PaginatedResult {
  data: PendingRequest[];
  total: number;
  page: number;
  limit: number;
  has_next: boolean;
}

@Injectable()
export class MultisigService {
  private contractId: string;
  private server: rpc.Server;
  private networkPassphrase: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly stellarService: StellarService,
    private readonly logger: LoggingService,
  ) {
    this.initializeMultisig();
  }

  private initializeMultisig() {
    const contractId = this.configService.get<string>('MULTISIG_CONTRACT_ID');
    const horizonUrl = this.configService.get<string>('STELLAR_HORIZON_URL');
    const network = this.configService.get<string>('STELLAR_NETWORK');

    if (!contractId || !horizonUrl || !network) {
      this.logger.warn(
        'Multisig configuration missing. MultisigService may not function correctly.',
      );
      return;
    }

    this.contractId = contractId;
    this.networkPassphrase =
      network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
    this.server = new rpc.Server(horizonUrl, {
      allowHttp: horizonUrl.includes('localhost'),
    });

    this.logger.log(`MultisigService initialized with contract: ${contractId}`);
  }

  /**
   * Initialize multisig configuration for an issuer
   */

  /**
   * Issue #721 – Poll getTransaction until the RPC reports a terminal status.
   * Calling getTransaction in the same tick as sendTransaction almost always
   * returns PENDING/NOT_FOUND; we must wait for SUCCESS or FAILED.
   */
  private async waitForTransaction(
    hash: string,
    options?: { maxAttempts?: number; intervalMs?: number },
  ): Promise<rpc.Api.GetTransactionResponse> {
    const maxAttempts = options?.maxAttempts ?? 30;
    const intervalMs = options?.intervalMs ?? 2000;

    let last: rpc.Api.GetTransactionResponse | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      last = await this.server.getTransaction(hash);
      const status = last.status;
      if (
        status === rpc.Api.GetTransactionStatus.SUCCESS ||
        status === rpc.Api.GetTransactionStatus.FAILED
      ) {
        return last;
      }
      // NOT_FOUND / PENDING – wait and retry
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(
      `Transaction ${hash} not finalized after ${maxAttempts} attempts (last status: ${last?.status ?? 'unknown'})`,
    );
  }

  async initMultisigConfig(
    adminPublicKey: string,
    issuer: string,
    threshold: number,
    signers: string[],
    maxSigners: number,
  ): Promise<string> {
    try {
      const adminKeyPair =
        this.stellarService.getKeypairFromPublicKey(adminPublicKey);
      const rpcAccount = await this.server.getAccount(adminPublicKey);
      const sourceAccount = new Account(
        adminPublicKey,
        rpcAccount.sequenceNumber(),
      );

      const contract = new Contract(this.contractId);

      // Convert parameters to ScVal
      const issuerScVal = new Address(issuer).toScVal();
      const thresholdScVal = xdr.ScVal.scvU32(threshold);
      const signersScVal = xdr.ScVal.scvVec(
        signers.map((signer) => new Address(signer).toScVal()),
      );
      const maxSignersScVal = xdr.ScVal.scvU32(maxSigners);
      const adminScVal = new Address(adminPublicKey).toScVal();

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100000',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'init_multisig_config',
            issuerScVal,
            thresholdScVal,
            signersScVal,
            maxSignersScVal,
            adminScVal,
          ),
        )
        .setTimeout(30)
        .build();

      transaction.sign(adminKeyPair);
      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING') {
        const txResponse = await this.pollTransaction(response.hash);
        if (txResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
          this.logger.log(`Multisig config initialized for issuer: ${issuer}`);
          return response.hash;
        }
      }

      throw new Error(`Transaction failed: ${response.status}`);
    } catch (error) {
      this.logger.error(
        `Failed to initialize multisig config for issuer ${issuer}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Update multisig configuration for an issuer
   */
  async updateMultisigConfig(
    adminPublicKey: string,
    issuer: string,
    newThreshold?: number,
    newSigners?: string[],
    newMaxSigners?: number,
  ): Promise<string> {
    try {
      const adminKeyPair =
        this.stellarService.getKeypairFromPublicKey(adminPublicKey);
      const accountResponse = await this.server.getAccount(adminPublicKey);
      const sourceAccount = new Account(
        adminPublicKey,
        accountResponse.sequenceNumber(),
      );

      const contract = new Contract(this.contractId);

      // Convert parameters to ScVal (using Option types)
      const thresholdScVal =
        newThreshold !== undefined
          ? xdr.ScVal.scvU32(newThreshold)
          : xdr.ScVal.scvVoid();

      const signersScVal =
        newSigners !== undefined
          ? xdr.ScVal.scvVec(
              newSigners.map((signer) => new Address(signer).toScVal()),
            )
          : xdr.ScVal.scvVoid();

      const maxSignersScVal =
        newMaxSigners !== undefined
          ? xdr.ScVal.scvU32(newMaxSigners)
          : xdr.ScVal.scvVoid();

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100000',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'update_multisig_config',
            new Address(issuer).toScVal(),
            thresholdScVal,
            signersScVal,
            maxSignersScVal,
          ),
        )
        .setTimeout(30)
        .build();

      transaction.sign(adminKeyPair);
      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING') {
        const txResponse = await this.pollTransaction(response.hash);
        if (txResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
          this.logger.log(`Multisig config updated for issuer: ${issuer}`);
          return response.hash;
        }
      }

      throw new Error(`Transaction failed: ${response.status}`);
    } catch (error) {
      this.logger.error(
        `Failed to update multisig config for issuer ${issuer}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Propose a new certificate for multi-sig issuance
   */
  async proposeCertificate(
    requesterPublicKey: string,
    requestId: string,
    issuer: string,
    recipient: string,
    metadata: string,
    expirationDays: number,
  ): Promise<PendingRequest> {
    try {
      const requesterKeyPair =
        this.stellarService.getKeypairFromPublicKey(requesterPublicKey);
      const accountResponse = await this.server.getAccount(requesterPublicKey);
      const sourceAccount = new Account(
        requesterPublicKey,
        accountResponse.sequenceNumber(),
      );

      const contract = new Contract(this.contractId);

      // Convert parameters to ScVal
      const requestIdScVal = xdr.ScVal.scvString(requestId);
      const issuerScVal = new Address(issuer).toScVal();
      const recipientScVal = new Address(recipient).toScVal();
      const metadataScVal = xdr.ScVal.scvString(metadata);
      const expirationDaysScVal = xdr.ScVal.scvU32(expirationDays);

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100000',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'propose_certificate',
            requestIdScVal,
            issuerScVal,
            recipientScVal,
            metadataScVal,
            expirationDaysScVal,
          ),
        )
        .setTimeout(30)
        .build();

      transaction.sign(requesterKeyPair);
      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING') {
        const txResponse = await this.pollTransaction(response.hash);
        if (txResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
          this.logger.log(`Certificate proposed with request ID: ${requestId}`);
          // Parse the PendingRequest returned directly by the contract
          if (txResponse.returnValue) {
            return this.parsePendingRequest(txResponse.returnValue);
          }
        }
      }

      throw new Error(`Transaction failed: ${response.status}`);
    } catch (error) {
      this.logger.error(
        `Failed to propose certificate with request ID ${requestId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Approve a pending certificate request
   */
  async approveRequest(
    approverPublicKey: string,
    requestId: string,
  ): Promise<SignatureResult> {
    try {
      const approverKeyPair =
        this.stellarService.getKeypairFromPublicKey(approverPublicKey);
      const accountResponse = await this.server.getAccount(approverPublicKey);
      const sourceAccount = new Account(
        approverPublicKey,
        accountResponse.sequenceNumber(),
      );

      const contract = new Contract(this.contractId);

      // Convert parameters to ScVal
      const requestIdScVal = xdr.ScVal.scvString(requestId);
      const approverScVal = new Address(approverPublicKey).toScVal();

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100000',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call('approve_request', requestIdScVal, approverScVal),
        )
        .setTimeout(30)
        .build();

      transaction.sign(approverKeyPair);
      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING') {
        const txResponse = await this.pollTransaction(response.hash);
        if (txResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
          this.logger.log(
            `Request ${requestId} approved by ${approverPublicKey}`,
          );
          // Parse the SignatureResult returned directly by the contract
          if (txResponse.returnValue) {
            return this.parseSignatureResult(txResponse.returnValue);
          }
        }
      }

      throw new Error(`Transaction failed: ${response.status}`);
    } catch (error) {
      this.logger.error(`Failed to approve request ${requestId}`, error);
      throw error;
    }
  }

  /**
   * Reject a pending certificate request
   */
  async rejectRequest(
    rejectorPublicKey: string,
    requestId: string,
    reason?: string,
  ): Promise<SignatureResult> {
    try {
      const rejectorKeyPair =
        this.stellarService.getKeypairFromPublicKey(rejectorPublicKey);
      const accountResponse = await this.server.getAccount(rejectorPublicKey);
      const sourceAccount = new Account(
        rejectorPublicKey,
        accountResponse.sequenceNumber(),
      );

      const contract = new Contract(this.contractId);

      // Convert parameters to ScVal
      const requestIdScVal = xdr.ScVal.scvString(requestId);
      const rejectorScVal = new Address(rejectorPublicKey).toScVal();
      const reasonScVal = reason
        ? xdr.ScVal.scvString(reason)
        : xdr.ScVal.scvVoid();

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100000',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'reject_request',
            requestIdScVal,
            rejectorScVal,
            reasonScVal,
          ),
        )
        .setTimeout(30)
        .build();

      transaction.sign(rejectorKeyPair);
      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING') {
        const txResponse = await this.pollTransaction(response.hash);
        if (txResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
          this.logger.log(
            `Request ${requestId} rejected by ${rejectorPublicKey}`,
          );
          // Parse the SignatureResult returned directly by the contract
          if (txResponse.returnValue) {
            return this.parseSignatureResult(txResponse.returnValue);
          }
        }
      }

      throw new Error(`Transaction failed: ${response.status}`);
    } catch (error) {
      this.logger.error(`Failed to reject request ${requestId}`, error);
      throw error;
    }
  }

  /**
   * Issue an approved certificate
   */
  async issueApprovedCertificate(
    requesterPublicKey: string,
    requestId: string,
  ): Promise<boolean> {
    try {
      const requesterKeyPair =
        this.stellarService.getKeypairFromPublicKey(requesterPublicKey);
      const accountResponse = await this.server.getAccount(requesterPublicKey);
      const sourceAccount = new Account(
        requesterPublicKey,
        accountResponse.sequenceNumber(),
      );

      const contract = new Contract(this.contractId);

      // Convert parameters to ScVal
      const requestIdScVal = xdr.ScVal.scvString(requestId);

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100000',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call('issue_approved_certificate', requestIdScVal),
        )
        .setTimeout(30)
        .build();

      transaction.sign(requesterKeyPair);
      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING') {
        const txResponse = await this.pollTransaction(response.hash);
        if (txResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
          this.logger.log(
            `Approved certificate issued for request: ${requestId}`,
          );
          return true;
        }
      }

      throw new Error(`Transaction failed: ${response.status}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to issue certificate for request ${requestId}`,
        message,
      );
      throw error;
    }
  }

  /**
   * Cancel a pending request
   */
  async cancelRequest(
    requesterPublicKey: string,
    requestId: string,
  ): Promise<boolean> {
    try {
      const requesterKeyPair =
        this.stellarService.getKeypairFromPublicKey(requesterPublicKey);
      const accountResponse = await this.server.getAccount(requesterPublicKey);
      const sourceAccount = new Account(
        requesterPublicKey,
        accountResponse.sequenceNumber(),
      );

      const contract = new Contract(this.contractId);

      // Convert parameters to ScVal
      const requestIdScVal = xdr.ScVal.scvString(requestId);
      const requesterScVal = new Address(requesterPublicKey).toScVal();

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100000',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call('cancel_request', requestIdScVal, requesterScVal),
        )
        .setTimeout(30)
        .build();

      transaction.sign(requesterKeyPair);
      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING') {
        const txResponse = await this.pollTransaction(response.hash);
        if (txResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
          this.logger.log(
            `Request ${requestId} cancelled by ${requesterPublicKey}`,
          );
          return true;
        }
      }

      throw new Error(`Transaction failed: ${response.status}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to cancel request ${requestId}`, message);
      throw error;
    }
  }

  /**
   * Get multisig configuration for an issuer
   */
  async getMultisigConfig(issuer: string): Promise<MultisigConfig> {
    try {
      const contract = new Contract(this.contractId);

      // Convert parameters to ScVal
      const issuerScVal = new Address(issuer).toScVal();

      const dummyAccount = new Account(
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        '0',
      );
      const transaction = new TransactionBuilder(dummyAccount, {
        fee: '0',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('get_multisig_config', issuerScVal))
        .setTimeout(0)
        .build();

      const response = await this.server.simulateTransaction(transaction);

      if (rpc.Api.isSimulationSuccess(response)) {
        if (response.result) {
          return this.parseMultisigConfig(response.result.retval);
        }
      }

      throw new Error('Invalid response from contract');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to get multisig config for issuer ${issuer}`,
        message,
      );
      throw error;
    }
  }

  /**
   * Get pending request by ID
   */
  async getPendingRequest(requestId: string): Promise<PendingRequest> {
    try {
      const contract = new Contract(this.contractId);

      // Convert parameters to ScVal
      const requestIdScVal = xdr.ScVal.scvString(requestId);

      const dummyAccount = new Account(
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        '0',
      );
      const transaction = new TransactionBuilder(dummyAccount, {
        fee: '0',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('get_pending_request', requestIdScVal))
        .setTimeout(0)
        .build();

      const response = await this.server.simulateTransaction(transaction);

      if (rpc.Api.isSimulationSuccess(response)) {
        if (response.result) {
          return this.parsePendingRequest(response.result.retval);
        }
      }

      throw new Error('Invalid response from contract');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get pending request ${requestId}`, message);
      throw error;
    }
  }

  /**
   * Check if a request is expired
   */
  async isRequestExpired(requestId: string): Promise<boolean> {
    try {
      const contract = new Contract(this.contractId);

      // Convert parameters to ScVal
      const requestIdScVal = xdr.ScVal.scvString(requestId);

      const dummyAccount = new Account(
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        '0',
      );
      const transaction = new TransactionBuilder(dummyAccount, {
        fee: '0',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('is_expired', requestIdScVal))
        .setTimeout(0)
        .build();

      const response = await this.server.simulateTransaction(transaction);

      if (rpc.Api.isSimulationSuccess(response)) {
        const simResult = response.result;
        if (simResult) {
          return this.parseBooleanResult(simResult.retval);
        }
      }

      throw new Error('Invalid response from contract');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to check if request ${requestId} is expired`,
        message,
      );
      throw error;
    }
  }

  /**
   * Get pending requests for an issuer
   */
  async getPendingRequestsForIssuer(
    issuer: string,
    pagination: Pagination,
  ): Promise<PaginatedResult> {
    try {
      const contract = new Contract(this.contractId);

      // Convert parameters to ScVal
      const issuerScVal = new Address(issuer).toScVal();
      const paginationScVal = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('page'),
          val: xdr.ScVal.scvU32(pagination.page),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('limit'),
          val: xdr.ScVal.scvU32(pagination.limit),
        }),
      ]);

      const dummyAccount = new Account(
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        '0',
      );
      const transaction = new TransactionBuilder(dummyAccount, {
        fee: '0',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'get_pending_requests_for_issuer',
            issuerScVal,
            paginationScVal,
          ),
        )
        .setTimeout(0)
        .build();

      const response = await this.server.simulateTransaction(transaction);

      if (rpc.Api.isSimulationSuccess(response)) {
        if (response.result) {
          return this.parsePaginatedResult(response.result.retval);
        }
      }

      throw new Error('Invalid response from contract');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to get pending requests for issuer ${issuer}`,
        message,
      );
      throw error;
    }
  }

  /**
   * Get pending requests for a signer
   */
  async getPendingRequestsForSigner(
    signer: string,
    pagination: Pagination,
  ): Promise<PaginatedResult> {
    try {
      const contract = new Contract(this.contractId);

      // Convert parameters to ScVal
      const signerScVal = new Address(signer).toScVal();
      const paginationScVal = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('page'),
          val: xdr.ScVal.scvU32(pagination.page),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('limit'),
          val: xdr.ScVal.scvU32(pagination.limit),
        }),
      ]);

      const dummyAccount = new Account(
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        '0',
      );
      const transaction = new TransactionBuilder(dummyAccount, {
        fee: '0',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'get_pending_requests_for_signer',
            signerScVal,
            paginationScVal,
          ),
        )
        .setTimeout(0)
        .build();

      const response = await this.server.simulateTransaction(transaction);

      if (rpc.Api.isSimulationSuccess(response)) {
        if (response.result) {
          return this.parsePaginatedResult(response.result.retval);
        }
      }

      throw new Error('Invalid response from contract');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to get pending requests for signer ${signer}`,
        message,
      );
      throw error;
    }
  }

  private mapNativeToPendingRequest(
    r: Record<string, unknown>,
  ): PendingRequest {
    return {
      id: Buffer.isBuffer(r['id']) ? r['id'].toString() : String(r['id']),
      issuer: r['issuer'] as string,
      recipient: r['recipient'] as string,
      metadata: Buffer.isBuffer(r['metadata'])
        ? r['metadata'].toString()
        : String(r['metadata']),
      proposer: r['proposer'] as string,
      approvals: (r['approvals'] as string[]) ?? [],
      rejections: (r['rejections'] as string[]) ?? [],
      rejection_reason:
        r['rejection_reason'] != null
          ? String(r['rejection_reason'])
          : undefined,
      created_at: Number(r['created_at']),
      expires_at: Number(r['expires_at']),
      status: Number(r['status']),
    };
  }

  private parseMultisigConfig(retval: xdr.ScVal): MultisigConfig {
    const native = scValToNative(retval) as Record<string, unknown>;
    return {
      threshold: Number(native['threshold']),
      signers: (native['signers'] as string[]) ?? [],
      max_signers: Number(native['max_signers']),
    };
  }

  private parseBooleanResult(retval: xdr.ScVal | undefined): boolean {
    if (!retval || retval.switch().name !== 'scvBool') {
      throw new Error('Invalid boolean response from contract');
    }

    return retval.b();
  }

  private parsePendingRequest(retval: xdr.ScVal): PendingRequest {
    return this.mapNativeToPendingRequest(
      scValToNative(retval) as Record<string, unknown>,
    );
  }

  private parsePaginatedResult(retval: xdr.ScVal): PaginatedResult {
    const native = scValToNative(retval) as Record<string, unknown>;
    const data = ((native['data'] as unknown[]) ?? []).map((item) =>
      this.mapNativeToPendingRequest(item as Record<string, unknown>),
    );
    return {
      data,
      total: Number(native['total']),
      page: Number(native['page']),
      limit: Number(native['limit']),
      has_next: Boolean(native['has_next']),
    };
  }

  /**
   * Parse the SignatureResult struct returned by approve_request / reject_request.
   *
   * The Soroban contract returns:
   *   { success: bool, message: String, final_status: Option<RequestStatus> }
   */
  private parseSignatureResult(retval: xdr.ScVal): SignatureResult {
    const native = scValToNative(retval) as Record<string, unknown>;
    const result: SignatureResult = {
      success: Boolean(native['success']),
      message: Buffer.isBuffer(native['message'])
        ? native['message'].toString()
        : String(native['message'] ?? ''),
    };
    if (native['final_status'] != null) {
      result.final_status = Number(native['final_status']);
    }
    return result;
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
      const status: string = txResponse.status;

      // SUCCESS or FAILED are terminal states — stop polling.
      if (
        status === rpc.Api.GetTransactionStatus.SUCCESS ||
        status === rpc.Api.GetTransactionStatus.FAILED
      ) {
        return txResponse;
      }

      // NOT_FOUND means the ledger hasn't closed yet; PENDING is the same.
      // Any other unexpected status should surface as an error immediately.
      if (
        status !== rpc.Api.GetTransactionStatus.NOT_FOUND &&
        status !== 'PENDING'
      ) {
        throw new Error(
          `Unexpected transaction status on attempt ${attempt}: ${status}`,
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
}
