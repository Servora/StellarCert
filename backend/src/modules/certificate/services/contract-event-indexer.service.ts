import { Injectable, Optional } from '@nestjs/common';
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
import { User } from '../../users/entities/user.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { EmailService } from '../../email/email.service';
import { EmailQueueService } from '../../email/email-queue.service';
import { SendRevocationNoticeDto } from '../../email/dto/send-revocation-notice.dto';
import { SendCertificateIssuedDto } from '../../email/dto/send-certificate-issued.dto';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction } from '../../audit/constants/audit-action.enum';
import { AuditResourceType } from '../../audit/constants/audit-resource-type.enum';

const CURSOR_NAME = 'soroban-contract-events';
const PAGE_LIMIT = 100;
const MAX_PAGES_PER_RUN = 20;
/**
 * While the indexer is working through a backlog, webhooks are dispatched at
 * most this many per second (override with
 * `CONTRACT_EVENT_INDEXER_CATCHUP_WEBHOOKS_PER_SECOND`). Steady-state polling,
 * where a page is not full, is never throttled.
 */
const DEFAULT_CATCHUP_WEBHOOKS_PER_SECOND = 20;

/**
 * Mirrors on-chain state into the database.
 *
 * Polls the Soroban RPC `getEvents` method for the certificate and CRL
 * contracts, persists a cursor after every page, and applies each event to
 * `certificates.status`, the certificate owner (transfers) and CRL revocations.
 * Webhooks fire only when an event actually changes the stored state, so
 * replays and events for changes the backend already made are silent.
 *
 * Webhook fan-out is paced while catching up on a backlog (see
 * `DEFAULT_CATCHUP_WEBHOOKS_PER_SECOND`) so a newly enabled indexer cannot flood
 * subscriber endpoints; chain state is still applied at full speed per page.
 *
 * Disabled unless `CONTRACT_EVENT_INDEXER_ENABLED=true`. When there is no
 * cursor yet, indexing starts at `CONTRACT_EVENT_INDEXER_START_LEDGER` or, if
 * unset, at the current ledger.
 */
@Injectable()
export class ContractEventIndexerService {
  private running = false;
  /** True while the current page was full or earlier pages were: a backlog. */
  private catchingUp = false;
  private lastDispatchAt = 0;

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
    @Optional()
    @InjectRepository(User)
    private readonly userRepository?: Repository<User>,
    @Optional()
    private readonly notificationsService?: NotificationsService,
    @Optional()
    private readonly emailService?: EmailService,
    @Optional()
    private readonly emailQueueService?: EmailQueueService,
    @Optional()
    private readonly auditService?: AuditService,
  ) {}

  /** Audit only a state transition that this indexer actually persisted. */
  private async auditOnChainChange(
    action: AuditAction,
    cert: Certificate,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    txHash: string,
    event: RawContractEvent,
  ): Promise<void> {
    if (!this.auditService) return;
    await this.auditService.log({
      action,
      resourceType: AuditResourceType.CERTIFICATE,
      resourceId: cert.id,
      transactionHash: txHash,
      changes: { before, after },
      metadata: {
        source: 'soroban_contract_event',
        eventId: event.id,
        ledger: event.ledger,
        contractId: event.contractId,
      },
      status: 'success',
    });
  }

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
      // A previous run that found no events still recorded how far it had
      // polled; resume there instead of re-deriving the start from scratch.
      const resumeLedger = state?.lastLedger;
      const configured = Number(
        this.configService.get('CONTRACT_EVENT_INDEXER_START_LEDGER'),
      );
      startLedger =
        resumeLedger && resumeLedger > 0
          ? resumeLedger
          : Number.isFinite(configured) && configured > 0
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

      // A full page (or any page after the first) means there is a backlog.
      this.catchingUp = page > 0 || result.events.length >= PAGE_LIMIT;

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
      } else if (
        Number.isFinite(result.latestLedger) &&
        result.latestLedger > (state?.lastLedger ?? 0)
      ) {
        // Caught up with nothing new and no paging token yet: mark the ledger
        // polled through so a restart resumes here (see `resumeLedger`).
        state = await this.cursorRepository.save(
          this.cursorRepository.create({
            name: CURSOR_NAME,
            cursor: null,
            lastLedger: result.latestLedger,
          }),
        );
      }

      if (result.events.length < PAGE_LIMIT) break;
    }
    this.catchingUp = false;
    return processed;
  }

  /** Test seam: the clock. */
  protected now(): number {
    return Date.now();
  }

  /** Test seam: waiting. */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private catchUpWebhooksPerSecond(): number {
    const configured = Number(
      this.configService.get(
        'CONTRACT_EVENT_INDEXER_CATCHUP_WEBHOOKS_PER_SECOND',
      ),
    );
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_CATCHUP_WEBHOOKS_PER_SECOND;
  }

  /**
   * Dispatch webhooks for an applied event. During backlog catch-up the
   * dispatches are spaced out; otherwise they go out immediately.
   */
  private async dispatchWebhook(
    event: WebhookEvent,
    issuerId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (this.catchingUp) {
      const gap = 1000 / this.catchUpWebhooksPerSecond();
      const wait = this.lastDispatchAt + gap - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastDispatchAt = this.now();
    }
    await this.webhooksService.triggerEvent(event, issuerId, payload);
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
            event,
          );
        }
        return;
      }

      const id = topics[1] !== undefined ? String(topics[1]) : undefined;
      switch (name) {
        case 'issued':
          if (id) await this.applyIssued(id, event);
          break;
        case 'revoked':
          if (id) await this.applyRevoked(id, data?.reason, event.txHash, event);
          break;
        case 'suspend':
        case 'frozen':
          if (id) await this.applyFrozen(id, data?.reason, event);
          break;
        case 'reinstat':
        case 'unfrozen':
          if (id) await this.applyUnfrozen(id, event);
          break;
        case 'transfer_done':
          if (data?.certificate_id) {
            await this.applyTransferDone(
              String(data.certificate_id),
              data.to_owner ? String(data.to_owner) : undefined,
              event,
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

  /**
   * Resolve the recipient user account ID for in-app notifications.
   * If not stored directly on the certificate, looks up the user account by recipientEmail.
   */
  private async resolveRecipientUserId(
    cert: Certificate,
  ): Promise<string | undefined> {
    if (cert.recipientId) return cert.recipientId;
    if (this.userRepository && cert.recipientEmail) {
      try {
        const user = await this.userRepository.findOne({
          where: { email: cert.recipientEmail },
          select: { id: true },
        });
        return user?.id;
      } catch (err: unknown) {
        this.logger.warn(
          `Failed to resolve recipient user ID for ${cert.recipientEmail}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return undefined;
  }

  /**
   * Deliver an in-app notification to a user.
   * Swallows errors so notification failures never abort chain sync.
   */
  private async sendNotification(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
  ): Promise<void> {
    if (!this.notificationsService) return;
    try {
      await this.notificationsService.createNotification(
        userId,
        type,
        title,
        message,
      );
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to send notification to ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Deliver a transactional email. Goes through BullMQ when available for retries,
   * falling back to direct delivery via EmailService.
   * Swallows errors so email failures never abort chain sync.
   */
  private async deliverEmail(
    description: string,
    recipient: string,
    viaQueue: ((queue: EmailQueueService) => Promise<void>) | null,
    direct: ((email: EmailService) => Promise<void>) | null,
  ): Promise<void> {
    if (this.emailQueueService && viaQueue) {
      try {
        await viaQueue(this.emailQueueService);
        return;
      } catch (queueErr: unknown) {
        this.logger.warn(
          `Could not queue ${description} to ${recipient}: ${queueErr instanceof Error ? queueErr.message : String(queueErr)}; sending directly`,
        );
      }
    }
    if (this.emailService && direct) {
      try {
        await direct(this.emailService);
      } catch (emailErr: unknown) {
        this.logger.warn(
          `Failed to send ${description} to ${recipient}: ${emailErr instanceof Error ? emailErr.message : String(emailErr)}`,
        );
      }
    }
  }

  private async applyIssued(id: string, event: RawContractEvent): Promise<void> {
    const cert = await this.findByOnChainId(id);
    if (!cert || cert.status !== CertificateStatus.PENDING) return;
    const previousStatus = cert.status;
    cert.status = CertificateStatus.ACTIVE;
    await this.certificateRepository.save(cert);
    await this.auditOnChainChange(
      AuditAction.CERTIFICATE_ISSUE, cert,
      { status: previousStatus }, { status: cert.status },
      event.txHash, event,
    );
    await this.dispatchWebhook(WebhookEvent.CERTIFICATE_ISSUED, cert.issuerId, {
      id: cert.id,
      status: cert.status,
      source: 'chain',
    });

    const recipientUserId = await this.resolveRecipientUserId(cert);
    if (cert.issuerId) {
      await this.sendNotification(
        cert.issuerId,
        NotificationType.SUCCESS,
        'Certificate Issued',
        `Certificate "${cert.title}" has been confirmed on-chain.`,
      );
    }
    if (recipientUserId && recipientUserId !== cert.issuerId) {
      await this.sendNotification(
        recipientUserId,
        NotificationType.SUCCESS,
        'Certificate Issued',
        `Certificate "${cert.title}" has been issued to you.`,
      );
    }

    if (cert.recipientEmail) {
      const issuedDto: SendCertificateIssuedDto = {
        to: cert.recipientEmail,
        certificateId: cert.certificateId || cert.id,
        recipientName: cert.recipientName || 'Recipient',
        certificateName: cert.title,
        issuerName: cert.issuerName || 'Issuer',
      };
      await this.deliverEmail(
        'certificate issued email',
        cert.recipientEmail,
        (queue) => queue.queueCertificateIssued(issuedDto),
        (email) => email.sendCertificateIssued(issuedDto),
      );
    }
  }

  private async applyRevoked(
    id: string,
    reason: string | undefined,
    txHash: string,
    event: RawContractEvent,
  ): Promise<void> {
    const cert = await this.findByOnChainId(id);
    if (!cert || cert.status === CertificateStatus.REVOKED) return;
    const previousStatus = cert.status;
    cert.status = CertificateStatus.REVOKED;
    cert.revokedAt = new Date();
    if (reason) cert.revocationReason = reason;
    await this.certificateRepository.save(cert);
    await this.auditOnChainChange(
      AuditAction.CERTIFICATE_REVOKE, cert,
      { status: previousStatus },
      { status: cert.status, revocationReason: cert.revocationReason },
      txHash, event,
    );
    await this.dispatchWebhook(
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

    const recipientUserId = await this.resolveRecipientUserId(cert);
    const reasonText = reason ? ` Reason: ${reason}` : '';
    if (cert.issuerId) {
      await this.sendNotification(
        cert.issuerId,
        NotificationType.ERROR,
        'Certificate Revoked',
        `Certificate "${cert.title}" has been revoked on-chain.${reasonText}`,
      );
    }
    if (recipientUserId && recipientUserId !== cert.issuerId) {
      await this.sendNotification(
        recipientUserId,
        NotificationType.ERROR,
        'Certificate Revoked',
        `Certificate "${cert.title}" has been revoked.${reasonText}`,
      );
    }

    if (cert.recipientEmail) {
      const revocationDto: SendRevocationNoticeDto = {
        to: cert.recipientEmail,
        recipientName: cert.recipientName || 'Recipient',
        certificateId: cert.certificateId || cert.id,
        certificateName: cert.title,
        reason: reason || cert.revocationReason || 'Revoked on-chain',
        revocationDate: (cert.revokedAt || new Date()).toISOString(),
      };
      await this.deliverEmail(
        'revocation notice email',
        cert.recipientEmail,
        (queue) => queue.queueRevocationNotice(revocationDto),
        (email) => email.sendRevocationNotice(revocationDto),
      );
    }
  }

  private async applyFrozen(id: string, reason: string | undefined, event: RawContractEvent): Promise<void> {
    const cert = await this.findByOnChainId(id);
    if (!cert || cert.status !== CertificateStatus.ACTIVE) return;
    const previousStatus = cert.status;
    cert.status = CertificateStatus.FROZEN;
    const frozenAt = new Date();
    cert.metadata = {
      ...(cert.metadata ?? {}),
      ...(reason ? { freezeReason: reason } : {}),
      frozenAt,
    };
    await this.certificateRepository.save(cert);
    await this.auditOnChainChange(
      AuditAction.CERTIFICATE_FREEZE, cert,
      { status: previousStatus }, { status: cert.status, freezeReason: reason },
      event.txHash, event,
    );
    await this.dispatchWebhook(WebhookEvent.CERTIFICATE_FROZEN, cert.issuerId, {
      id: cert.id,
      status: cert.status,
      ...(reason ? { freezeReason: reason } : {}),
      frozenAt,
      source: 'chain',
    });

    const recipientUserId = await this.resolveRecipientUserId(cert);
    const reasonText = reason ? ` Reason: ${reason}` : '';
    if (cert.issuerId) {
      await this.sendNotification(
        cert.issuerId,
        NotificationType.INFO,
        'Certificate Frozen',
        `Certificate "${cert.title}" has been frozen on-chain.${reasonText}`,
      );
    }
    if (recipientUserId && recipientUserId !== cert.issuerId) {
      await this.sendNotification(
        recipientUserId,
        NotificationType.INFO,
        'Certificate Frozen',
        `Certificate "${cert.title}" has been frozen.${reasonText}`,
      );
    }
  }

  private async applyUnfrozen(id: string, event: RawContractEvent): Promise<void> {
    const cert = await this.findByOnChainId(id);
    if (!cert || cert.status !== CertificateStatus.FROZEN) return;
    const previousStatus = cert.status;
    cert.status = CertificateStatus.ACTIVE;
    const unfrozenAt = new Date();
    cert.metadata = { ...(cert.metadata ?? {}), unfrozenAt };
    await this.certificateRepository.save(cert);
    await this.auditOnChainChange(
      AuditAction.CERTIFICATE_UNFREEZE, cert,
      { status: previousStatus }, { status: cert.status },
      event.txHash, event,
    );
    await this.dispatchWebhook(
      WebhookEvent.CERTIFICATE_UNFROZEN,
      cert.issuerId,
      { id: cert.id, status: cert.status, unfrozenAt, source: 'chain' },
    );

    const recipientUserId = await this.resolveRecipientUserId(cert);
    if (cert.issuerId) {
      await this.sendNotification(
        cert.issuerId,
        NotificationType.SUCCESS,
        'Certificate Unfrozen',
        `Certificate "${cert.title}" has been unfrozen on-chain.`,
      );
    }
    if (recipientUserId && recipientUserId !== cert.issuerId) {
      await this.sendNotification(
        recipientUserId,
        NotificationType.SUCCESS,
        'Certificate Unfrozen',
        `Certificate "${cert.title}" has been unfrozen.`,
      );
    }
  }

  private async applyTransferDone(
    certificateId: string,
    toOwner: string | undefined,
    event: RawContractEvent,
  ): Promise<void> {
    const cert = await this.findByOnChainId(certificateId);
    if (!cert) return;

    if (toOwner && cert.recipientStellarAddress !== toOwner) {
      const previousOwner = cert.recipientStellarAddress;
      cert.recipientStellarAddress = toOwner;
      await this.certificateRepository.save(cert);
      await this.auditOnChainChange(
        AuditAction.CERTIFICATE_TRANSFER, cert,
        { owner: previousOwner }, { owner: toOwner },
        event.txHash, event,
      );
    }

    await this.transferRepository.update(
      { certificateId: cert.id, status: TransferStatus.PENDING },
      { status: TransferStatus.APPROVED },
    );
  }
}
