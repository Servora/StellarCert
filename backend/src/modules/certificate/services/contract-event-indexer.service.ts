import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Interval } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { scValToNative } from '@stellar/stellar-sdk';

import { Certificate } from '../entities/certificate.entity';
import {
  CertificateTransfer,
  TransferStatus,
} from '../entities/certificate-transfer.entity';
import { ContractEventCursor } from '../entities/contract-event-cursor.entity';
import { CertificateStatus } from '../constants/certificate-status.enum';
import {
  RawContractEvent,
  SorobanService,
} from '../../stellar/services/soroban.service';
import { WebhooksService } from '../../webhooks/webhooks.service';
import { WebhookEvent } from '../../webhooks/entities/webhook-subscription.entity';
import { LoggingService } from '../../../common/logging/logging.service';

const CURSOR_NAME = 'soroban-contract-events';
const PAGE_LIMIT = 100;
const MAX_PAGES_PER_RUN = 20;

/**
 * Mirrors on-chain state into the database.
 *
 * Polls the Soroban RPC `getEvents` method for the certificate and CRL
 * contracts, persists a cursor after every page, and applies each event to
 * `certificates.status`, the certificate owner (transfers) and CRL revocations.
 * Webhooks fire only when an event actually changes the stored state, so
 * replays and events for changes the backend already made are silent.
 *
 * Disabled unless `CONTRACT_EVENT_INDEXER_ENABLED=true`. When there is no
 * cursor yet, indexing starts at `CONTRACT_EVENT_INDEXER_START_LEDGER` or, if
 * unset, at the current ledger.
 */
@Injectable()
export class ContractEventIndexerService {
  private running = false;

  constructor(
    @InjectRepository(Certificate)
    private readonly certificateRepository: Repository<Certificate>,
    @InjectRepository(CertificateTransfer)
    private readonly transferRepository: Repository<CertificateTransfer>,
    @InjectRepository(ContractEventCursor)
    private readonly cursorRepository: Repository<ContractEventCursor>,
    private readonly sorobanService: SorobanService,
    private readonly webhooksService: WebhooksService,
    private readonly configService: ConfigService,
    private readonly logger: LoggingService,
  ) {}

  isEnabled(): boolean {
    return (
      String(
        this.configService.get('CONTRACT_EVENT_INDEXER_ENABLED') ?? 'false',
      ).toLowerCase() === 'true'
    );
  }

  @Interval(10_000)
  async poll(): Promise<void> {
    if (!this.isEnabled() || this.running) return;
    if (
      !this.sorobanService.isConfigured() ||
      this.sorobanService.getEventContractIds().length === 0
    ) {
      return;
    }

    this.running = true;
    try {
      await this.syncOnce();
    } catch (error: unknown) {
      this.logger.error(
        `Contract event indexing failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** Read and apply pages until caught up (bounded per run). */
  async syncOnce(): Promise<number> {
    let state = await this.cursorRepository.findOne({
      where: { name: CURSOR_NAME },
    });
    let cursor = state?.cursor ?? undefined;
    let startLedger: number | undefined;

    if (!cursor) {
      const configured = Number(
        this.configService.get('CONTRACT_EVENT_INDEXER_START_LEDGER'),
      );
      startLedger =
        Number.isFinite(configured) && configured > 0
          ? configured
          : await this.sorobanService.getLatestLedgerSequence();
    }

    let processed = 0;
    for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
      const result = await this.sorobanService.getContractEvents({
        cursor,
        startLedger,
        limit: PAGE_LIMIT,
      });

      for (const event of result.events) {
        await this.handleEvent(event);
        processed++;
      }

      const next = result.events.length
        ? result.events[result.events.length - 1].pagingToken
        : (result.cursor ?? cursor);
      if (next) {
        cursor = next;
        startLedger = undefined;
        const lastLedger = result.events.length
          ? result.events[result.events.length - 1].ledger
          : (state?.lastLedger ?? null);
        state = await this.cursorRepository.save(
          this.cursorRepository.create({
            name: CURSOR_NAME,
            cursor,
            lastLedger,
          }),
        );
      }

      if (result.events.length < PAGE_LIMIT) break;
    }
    return processed;
  }

  async handleEvent(event: RawContractEvent): Promise<void> {
    if (!event.inSuccessfulContractCall) return;

    try {
      const topics = event.topic.map((t) => scValToNative(t));
      const data = event.value ? scValToNative(event.value) : undefined;
      const name = String(topics[0]);

      if (name === 'crl') {
        if (String(topics[1]) === 'revoked') {
          await this.applyRevoked(
            String(topics[2] ?? data?.certificate_id),
            `CRL revocation (reason code ${data?.reason ?? 'unknown'})`,
            event.txHash,
          );
        }
        return;
      }

      const id = topics[1] !== undefined ? String(topics[1]) : undefined;
      switch (name) {
        case 'issued':
          if (id) await this.applyIssued(id);
          break;
        case 'revoked':
          if (id) await this.applyRevoked(id, data?.reason, event.txHash);
          break;
        case 'suspend':
        case 'frozen':
          if (id) await this.applyFrozen(id, data?.reason);
          break;
        case 'reinstat':
        case 'unfrozen':
          if (id) await this.applyUnfrozen(id);
          break;
        case 'transfer_done':
          if (data?.certificate_id) {
            await this.applyTransferDone(
              String(data.certificate_id),
              data.to_owner ? String(data.to_owner) : undefined,
            );
          }
          break;
        default:
          break;
      }
    } catch (error: unknown) {
      this.logger.error(
        `Failed to apply contract event ${event.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private findByOnChainId(id: string): Promise<Certificate | null> {
    // The contract is keyed by the certificate's UUID (see issueCertificate).
    return this.certificateRepository.findOne({ where: { id } });
  }

  private async applyIssued(id: string): Promise<void> {
    const cert = await this.findByOnChainId(id);
    if (!cert || cert.status !== CertificateStatus.PENDING) return;
    cert.status = CertificateStatus.ACTIVE;
    await this.certificateRepository.save(cert);
    await this.webhooksService.triggerEvent(
      WebhookEvent.CERTIFICATE_ISSUED,
      cert.issuerId,
      { id: cert.id, status: cert.status, source: 'chain' },
    );
  }

  private async applyRevoked(
    id: string,
    reason: string | undefined,
    txHash: string,
  ): Promise<void> {
    const cert = await this.findByOnChainId(id);
    if (!cert || cert.status === CertificateStatus.REVOKED) return;
    cert.status = CertificateStatus.REVOKED;
    cert.revokedAt = new Date();
    if (reason) cert.revocationReason = reason;
    await this.certificateRepository.save(cert);
    await this.webhooksService.triggerEvent(
      WebhookEvent.CERTIFICATE_REVOKED,
      cert.issuerId,
      {
        id: cert.id,
        status: cert.status,
        revocationReason: reason,
        revokedAt: cert.revokedAt,
        transactionHash: txHash,
        source: 'chain',
      },
    );
  }

  private async applyFrozen(id: string, reason?: string): Promise<void> {
    const cert = await this.findByOnChainId(id);
    if (!cert || cert.status !== CertificateStatus.ACTIVE) return;
    cert.status = CertificateStatus.FROZEN;
    const frozenAt = new Date();
    cert.metadata = {
      ...(cert.metadata ?? {}),
      ...(reason ? { freezeReason: reason } : {}),
      frozenAt,
    };
    await this.certificateRepository.save(cert);
    await this.webhooksService.triggerEvent(
      WebhookEvent.CERTIFICATE_FROZEN,
      cert.issuerId,
      {
        id: cert.id,
        status: cert.status,
        ...(reason ? { freezeReason: reason } : {}),
        frozenAt,
        source: 'chain',
      },
    );
  }

  private async applyUnfrozen(id: string): Promise<void> {
    const cert = await this.findByOnChainId(id);
    if (!cert || cert.status !== CertificateStatus.FROZEN) return;
    cert.status = CertificateStatus.ACTIVE;
    const unfrozenAt = new Date();
    cert.metadata = { ...(cert.metadata ?? {}), unfrozenAt };
    await this.certificateRepository.save(cert);
    await this.webhooksService.triggerEvent(
      WebhookEvent.CERTIFICATE_UNFROZEN,
      cert.issuerId,
      { id: cert.id, status: cert.status, unfrozenAt, source: 'chain' },
    );
  }

  private async applyTransferDone(
    certificateId: string,
    toOwner?: string,
  ): Promise<void> {
    const cert = await this.findByOnChainId(certificateId);
    if (!cert) return;

    if (toOwner && cert.recipientStellarAddress !== toOwner) {
      cert.recipientStellarAddress = toOwner;
      await this.certificateRepository.save(cert);
    }

    await this.transferRepository.update(
      { certificateId: cert.id, status: TransferStatus.PENDING },
      { status: TransferStatus.APPROVED },
    );
  }
}
