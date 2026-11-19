import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CertificateTransfer,
  TransferStatus,
} from '../entities/certificate-transfer.entity';
import { Certificate } from '../entities/certificate.entity';
import { User } from '../../users/entities/user.entity';
import { EmailService } from '../../email/email.service';
import { InitiateTransferDto } from '../dto/transfer-certificate.dto';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction, AuditResourceType } from '../../audit/constants';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { LoggingService } from '../../../common/logging/logging.service';
import { UserRole } from '../../../common/constants/roles';
import { CryptoUtils } from '../../../common/utils/crypto.utils';

/**
 * Length of the secret code that authorises a transfer.
 *
 * The code is the second factor for approving a transfer, so it has to be
 * long enough that it cannot be brute-forced within the number of attempts a
 * transfer tolerates. 12 characters of the uppercase alphanumeric alphabet
 * leave 36^12 possibilities (~4.7e18).
 */
export const CONFIRMATION_CODE_LENGTH = 12;

/**
 * How many wrong confirmation codes a transfer tolerates before it is
 * locked. Locked transfers can no longer be approved and have to be
 * cancelled and initiated again.
 */
export const MAX_CONFIRMATION_CODE_ATTEMPTS = 5;

export interface TransferResponseDTO {
  id: string;
  certificateId: string;
  fromEmail: string;
  fromName: string;
  toEmail: string;
  toName: string;
  reason: string | null;
  status: TransferStatus;
  initiatedBy: string;
  initiatedAt: Date;
  expiresAt: Date | null;
  completedAt: Date | null;
  rejectionReason: string | null;
  /** Confirmation codes submitted so far that did not match. */
  failedAttempts: number;
  /** Set once the transfer was locked after too many failed attempts. */
  lockedAt: Date | null;
}

export interface TransferHistoryItemDTO {
  id: string;
  certificateId: string;
  fromEmail: string;
  fromName: string;
  toEmail: string;
  toName: string;
  reason: string | null;
  status: TransferStatus;
  initiatedBy: string;
  initiatedAt: Date;
  expiresAt: Date | null;
  completedAt: Date | null;
  rejectionReason: string | null;
}

@Injectable()
export class CertificateTransferService {
  constructor(
    @InjectRepository(CertificateTransfer)
    private readonly transferRepository: Repository<CertificateTransfer>,
    @InjectRepository(Certificate)
    private readonly certificateRepository: Repository<Certificate>,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly logger: LoggingService,
    @Optional()
    @InjectRepository(User)
    private readonly userRepository?: Repository<User>,
    @Optional()
    private readonly emailService?: EmailService,
  ) {}

  private toTransferResponseDTO(
    transfer: CertificateTransfer,
  ): TransferResponseDTO {
    return {
      id: transfer.id,
      certificateId: transfer.certificateId,
      fromEmail: transfer.fromEmail,
      fromName: transfer.fromName,
      toEmail: transfer.toEmail,
      toName: transfer.toName,
      reason: transfer.reason ?? null,
      status: transfer.status,
      initiatedBy: transfer.initiatedBy,
      initiatedAt: transfer.initiatedAt,
      expiresAt: transfer.expiresAt ?? null,
      completedAt: transfer.completedAt ?? null,
      rejectionReason: transfer.rejectionReason ?? null,
      failedAttempts: transfer.failedAttempts ?? 0,
      lockedAt: transfer.lockedAt ?? null,
    };
  }

  private toTransferHistoryItemDTO(
    transfer: CertificateTransfer,
  ): TransferHistoryItemDTO {
    return this.toTransferResponseDTO(transfer);
  }

  async initiateTransfer(
    dto: InitiateTransferDto,
    initiator: { id: string; role: string },
    ipAddress?: string,
  ): Promise<TransferResponseDTO> {
    const certificate = await this.certificateRepository.findOne({
      where: { id: dto.certificateId },
    });

    if (!certificate) {
      throw new NotFoundException(
        `Certificate with ID ${dto.certificateId} not found`,
      );
    }

    // Verify that only the certificate's issuer or an admin can initiate a transfer
    if (
      initiator.role !== UserRole.ADMIN &&
      certificate.issuerId !== initiator.id
    ) {
      throw new ForbiddenException(
        'You are not authorized to initiate a transfer for this certificate. Only the certificate issuer or an admin can perform this action.',
      );
    }

    if (certificate.status !== 'active') {
      throw new ConflictException(
        `Cannot transfer certificate with status: ${certificate.status}. Only active certificates can be transferred.`,
      );
    }

    // Check for existing pending transfers
    const existingTransfer = await this.transferRepository.findOne({
      where: {
        certificateId: dto.certificateId,
        status: TransferStatus.PENDING,
      },
    });

    if (existingTransfer) {
      throw new ConflictException(
        'A pending transfer already exists for this certificate',
      );
    }

    const confirmationCode = await this.generateConfirmationCode();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // Transfer expires in 7 days

    const transfer = this.transferRepository.create({
      certificateId: dto.certificateId,
      fromEmail: certificate.recipientEmail,
      fromName: certificate.recipientName,
      toEmail: dto.newOwnerEmail,
      toName: dto.newOwnerName,
      reason: dto.reason,
      confirmationCode,
      initiatedBy: initiator.id,
      expiresAt,
      status: TransferStatus.PENDING,
      failedAttempts: 0,
    });

    const savedTransfer = await this.transferRepository.save(transfer);

    // Log audit entry
    await this.auditService.log({
      action: AuditAction.CERTIFICATE_UPDATE,
      resourceType: AuditResourceType.CERTIFICATE,
      resourceId: dto.certificateId,
      userId: initiator.id,
      ipAddress: ipAddress || 'unknown',
      metadata: {
        transferId: savedTransfer.id,
        operation: 'transfer_initiated',
        fromEmail: certificate.recipientEmail,
        toEmail: dto.newOwnerEmail,
        reason: dto.reason,
      },
      status: 'success',
    });

    // Notify initiator (without exposing confirmation code)
    await this.notificationsService.createNotification(
      initiator.id,
      NotificationType.INFO,
      'Certificate Transfer Initiated',
      `Transfer of certificate "${certificate.title}" to ${dto.newOwnerEmail} has been initiated.`,
    );

    // Look up the new owner (toEmail) user account
    const recipientUser = this.userRepository
      ? await this.userRepository.findOne({
          where: { email: dto.newOwnerEmail },
        })
      : null;

    if (recipientUser) {
      // Send notification with confirmation code to the intended new owner
      await this.notificationsService.createNotification(
        recipientUser.id,
        NotificationType.INFO,
        'Certificate Transfer Confirmation Code',
        `A transfer of certificate "${certificate.title}" to your account has been initiated. Your confirmation code is: ${confirmationCode}`,
      );
    }

    // Send confirmation email containing the secret code to the new owner (toEmail)
    if (this.emailService) {
      try {
        await this.emailService.sendTransferConfirmationCode({
          to: dto.newOwnerEmail,
          recipientName: dto.newOwnerName || recipientUser?.firstName || 'User',
          certificateTitle: certificate.title,
          certificateId: certificate.id,
          confirmationCode,
        });
      } catch (emailErr) {
        this.logger.warn(
          `Failed to send transfer confirmation email to ${dto.newOwnerEmail}: ${emailErr.message}`,
        );
      }
    }

    this.logger.log(
      `Transfer initiated for certificate ${dto.certificateId} from ${certificate.recipientEmail} to ${dto.newOwnerEmail}`,
    );

    return this.toTransferResponseDTO(savedTransfer);
  }

  async approveTransfer(
    transferId: string,
    confirmationCode: string,
    approver: { id: string; role: string; email?: string },
    ipAddress?: string,
  ): Promise<TransferResponseDTO> {
    const transfer = await this.transferRepository.findOne({
      where: { id: transferId },
      relations: ['certificate'],
      select: {
        id: true,
        certificateId: true,
        fromEmail: true,
        fromName: true,
        toEmail: true,
        toName: true,
        reason: true,
        confirmationCode: true,
        initiatedBy: true,
        expiresAt: true,
        status: true,
        completedAt: true,
        rejectionReason: true,
        initiatedAt: true,
        failedAttempts: true,
        lockedAt: true,
      },
    });

    if (!transfer) {
      throw new NotFoundException(`Transfer with ID ${transferId} not found`);
    }

    if (transfer.status === TransferStatus.LOCKED) {
      throw new ConflictException(
        'Transfer is locked after too many invalid confirmation code attempts. Cancel it and initiate a new transfer to receive a fresh code.',
      );
    }

    if (transfer.status !== TransferStatus.PENDING) {
      throw new ConflictException(
        `Transfer is not pending. Current status: ${transfer.status}`,
      );
    }

    if (transfer.expiresAt && new Date() > transfer.expiresAt) {
      transfer.status = TransferStatus.EXPIRED;
      await this.transferRepository.save(transfer);
      throw new ConflictException('Transfer request has expired');
    }

    // Only the intended new owner may accept a transfer; the code alone is
    // not enough, since anyone who learned it could otherwise approve it.
    await this.assertIntendedNewOwner(transfer, approver);

    // The code is compared in constant time, and every wrong guess is
    // counted. After MAX_CONFIRMATION_CODE_ATTEMPTS the transfer is locked,
    // so a short code cannot be brute-forced.
    const expectedCode = (transfer.confirmationCode ?? '').trim().toUpperCase();
    const submittedCode =
      typeof confirmationCode === 'string'
        ? confirmationCode.trim().toUpperCase()
        : '';

    if (
      !expectedCode ||
      !CryptoUtils.timingSafeEquals(expectedCode, submittedCode)
    ) {
      await this.registerFailedConfirmationAttempt(
        transfer,
        approver,
        ipAddress,
      );
    }

    // Perform the actual ownership transfer
    const certificate = await this.certificateRepository.findOne({
      where: { id: transfer.certificateId },
    });

    if (!certificate) {
      throw new NotFoundException('Associated certificate not found');
    }

    if (certificate.status !== 'active') {
      throw new ConflictException(
        `Cannot transfer certificate with status: ${certificate.status}. Only active certificates can be transferred.`,
      );
    }

    if (certificate.recipientEmail !== transfer.fromEmail) {
      throw new ConflictException(
        'Certificate owner has changed since transfer was initiated',
      );
    }

    const previousEmail = certificate.recipientEmail;
    const previousName = certificate.recipientName;

    certificate.recipientEmail = transfer.toEmail;
    certificate.recipientName = transfer.toName;
    certificate.metadata = {
      ...certificate.metadata,
      additionalFields: {
        ...(certificate.metadata?.additionalFields ?? {}),
        transferHistory: [
          ...((certificate.metadata?.additionalFields?.[
            'transferHistory'
          ] as unknown[]) || []),
          {
            fromEmail: previousEmail,
            fromName: previousName,
            toEmail: transfer.toEmail,
            toName: transfer.toName,
            transferDate: new Date().toISOString(),
            reason: transfer.reason,
          },
        ],
      },
    };

    await this.certificateRepository.save(certificate);

    transfer.status = TransferStatus.APPROVED;
    transfer.completedAt = new Date();
    transfer.failedAttempts = 0;
    transfer.lockedAt = null;
    const savedTransfer = await this.transferRepository.save(transfer);

    // Log audit entry
    await this.auditService.log({
      action: AuditAction.CERTIFICATE_UPDATE,
      resourceType: AuditResourceType.CERTIFICATE,
      resourceId: transfer.certificateId,
      userId: approver.id,
      ipAddress: ipAddress || 'unknown',
      metadata: {
        transferId: savedTransfer.id,
        operation: 'transfer_approved',
        fromEmail: previousEmail,
        toEmail: transfer.toEmail,
      },
      changes: {
        before: { recipientEmail: previousEmail, recipientName: previousName },
        after: {
          recipientEmail: transfer.toEmail,
          recipientName: transfer.toName,
        },
      },
      status: 'success',
    });

    // Notify approver
    await this.notificationsService.createNotification(
      approver.id,
      NotificationType.SUCCESS,
      'Certificate Transfer Completed',
      `Certificate "${certificate.title}" has been successfully transferred to ${transfer.toEmail}.`,
    );

    // Look up the new owner (toEmail) user account and notify on completion
    const recipientUser = this.userRepository
      ? await this.userRepository.findOne({
          where: { email: transfer.toEmail },
        })
      : null;

    if (recipientUser) {
      await this.notificationsService.createNotification(
        recipientUser.id,
        NotificationType.SUCCESS,
        'Certificate Transfer Completed',
        `Certificate "${certificate.title}" has been successfully transferred to your account.`,
      );
    }

    // Send completion email to new owner (toEmail)
    if (this.emailService) {
      try {
        await this.emailService.sendTransferCompletedNotice({
          to: transfer.toEmail,
          recipientName: transfer.toName || recipientUser?.firstName || 'User',
          certificateTitle: certificate.title,
          certificateId: certificate.id,
        });
      } catch (emailErr) {
        this.logger.warn(
          `Failed to send transfer completed email to ${transfer.toEmail}: ${emailErr.message}`,
        );
      }
    }

    this.logger.log(
      `Transfer ${transferId} approved for certificate ${transfer.certificateId}`,
    );

    return this.toTransferResponseDTO(savedTransfer);
  }

  /**
   * Ensures the request comes from the account the certificate is being
   * transferred to.
   *
   * The account record is authoritative: the email carried by the access
   * token is only a snapshot taken when the token was minted and can be
   * stale. The account also has to have a verified email address, otherwise
   * anybody could register the target address and take over the certificate.
   */
  private async assertIntendedNewOwner(
    transfer: CertificateTransfer,
    approver: { id: string },
  ): Promise<void> {
    const intendedEmail = (transfer.toEmail ?? '').trim().toLowerCase();

    const approverUser = this.userRepository
      ? await this.userRepository.findOne({
          where: { id: approver.id },
          select: { id: true, email: true, isEmailVerified: true },
        })
      : null;

    const approverEmail = (approverUser?.email ?? '').trim().toLowerCase();

    if (!intendedEmail || !approverUser || approverEmail !== intendedEmail) {
      throw new ForbiddenException(
        'Only the intended new owner can approve this transfer',
      );
    }

    if (!approverUser.isEmailVerified) {
      throw new ForbiddenException(
        'Your email address must be verified before you can approve a certificate transfer',
      );
    }
  }

  /**
   * Counts a wrong confirmation code and locks the transfer once the maximum
   * number of attempts is reached. Always throws.
   */
  private async registerFailedConfirmationAttempt(
    transfer: CertificateTransfer,
    approver: { id: string },
    ipAddress?: string,
  ): Promise<never> {
    const attempts = await this.incrementFailedAttempts(transfer.id);
    const remaining = MAX_CONFIRMATION_CODE_ATTEMPTS - attempts;

    await this.auditService.log({
      action: AuditAction.UNAUTHORIZED_ACCESS,
      resourceType: AuditResourceType.CERTIFICATE,
      resourceId: transfer.certificateId,
      userId: approver.id,
      ipAddress: ipAddress || 'unknown',
      metadata: {
        transferId: transfer.id,
        operation: 'transfer_confirmation_code_failed',
        attempts,
        maxAttempts: MAX_CONFIRMATION_CODE_ATTEMPTS,
      },
      status: 'failure',
    });

    if (remaining > 0) {
      this.logger.warn(
        `Invalid confirmation code for transfer ${transfer.id}. ` +
          `${attempts}/${MAX_CONFIRMATION_CODE_ATTEMPTS} attempts used.`,
      );
      throw new ForbiddenException(
        `Invalid confirmation code. ${remaining} attempt(s) remaining before this transfer is locked.`,
      );
    }

    // Lock the transfer: it can no longer be approved, so the code cannot be
    // guessed any further. A fresh transfer has to be initiated.
    transfer.status = TransferStatus.LOCKED;
    transfer.lockedAt = new Date();
    transfer.failedAttempts = attempts;
    await this.transferRepository.save(transfer);

    await this.auditService.log({
      action: AuditAction.UNAUTHORIZED_ACCESS,
      resourceType: AuditResourceType.CERTIFICATE,
      resourceId: transfer.certificateId,
      userId: approver.id,
      ipAddress: ipAddress || 'unknown',
      metadata: {
        transferId: transfer.id,
        operation: 'transfer_locked',
        attempts,
        maxAttempts: MAX_CONFIRMATION_CODE_ATTEMPTS,
      },
      status: 'failure',
    });

    this.logger.warn(
      `Transfer ${transfer.id} locked after ${attempts} invalid confirmation code attempts`,
    );

    throw new ConflictException(
      'Too many invalid confirmation code attempts. This transfer is now locked; cancel it and initiate a new one.',
    );
  }

  /**
   * Increments the failed attempt counter of a transfer atomically and
   * returns the new count.
   *
   * The counter is bumped with a single statement so that concurrent guesses
   * cannot overwrite each other and slip past the limit. The raw statement is
   * used on purpose: TypeORM's `update`/`increment` also write the
   * `@UpdateDateColumn` of the entity, which is `completedAt` here, and that
   * would mark a still-pending transfer as completed.
   */
  private async incrementFailedAttempts(transferId: string): Promise<number> {
    const rows = await this.transferRepository.query(
      `UPDATE "certificate_transfers"
          SET "failedAttempts" = COALESCE("failedAttempts", 0) + 1
        WHERE "id" = $1
        RETURNING "failedAttempts"`,
      [transferId],
    );

    // For an UPDATE ... RETURNING, TypeORM's Postgres driver resolves to
    // `[returnedRows, affectedCount]`, not to the rows themselves. Reading
    // `rows[0].failedAttempts` therefore always saw undefined, the count was
    // reported as 0 and the transfer was never locked.
    const returned: Array<{ failedAttempts?: unknown }> =
      Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
    const attempts = Number(returned?.[0]?.failedAttempts);

    if (!Number.isFinite(attempts)) {
      // Never report "no attempts" on an unreadable result: that is exactly
      // the failure mode that disabled the lockout.
      throw new Error(
        `Could not read the failed-attempt count for transfer ${transferId}`,
      );
    }
    return attempts;
  }

  async rejectTransfer(
    transferId: string,
    reason: string,
    rejector: { id: string; role: string },
    ipAddress?: string,
  ): Promise<TransferResponseDTO> {
    const transfer = await this.transferRepository.findOne({
      where: { id: transferId },
    });

    if (!transfer) {
      throw new NotFoundException(`Transfer with ID ${transferId} not found`);
    }

    if (
      transfer.status !== TransferStatus.PENDING &&
      transfer.status !== TransferStatus.LOCKED
    ) {
      throw new ConflictException(
        `Transfer is not pending. Current status: ${transfer.status}`,
      );
    }

    transfer.status = TransferStatus.REJECTED;
    transfer.rejectionReason = reason;
    transfer.completedAt = new Date();
    const savedTransfer = await this.transferRepository.save(transfer);

    await this.auditService.log({
      action: AuditAction.CERTIFICATE_UPDATE,
      resourceType: AuditResourceType.CERTIFICATE,
      resourceId: transfer.certificateId,
      userId: rejector.id,
      ipAddress: ipAddress || 'unknown',
      metadata: {
        transferId: savedTransfer.id,
        operation: 'transfer_rejected',
        reason,
      },
      status: 'success',
    });

    return this.toTransferResponseDTO(savedTransfer);
  }

  async cancelTransfer(
    transferId: string,
    user: { id: string; role: string },
    ipAddress?: string,
  ): Promise<TransferResponseDTO> {
    const transfer = await this.transferRepository.findOne({
      where: { id: transferId },
    });

    if (!transfer) {
      throw new NotFoundException(`Transfer with ID ${transferId} not found`);
    }

    if (user.role !== UserRole.ADMIN && transfer.initiatedBy !== user.id) {
      throw new ForbiddenException(
        'You are not authorized to cancel this transfer',
      );
    }

    // A locked transfer can be cancelled too, otherwise the certificate
    // would be stuck with it and no fresh transfer could be initiated.
    if (
      transfer.status !== TransferStatus.PENDING &&
      transfer.status !== TransferStatus.LOCKED
    ) {
      throw new ConflictException(
        `Transfer is not pending. Current status: ${transfer.status}`,
      );
    }

    transfer.status = TransferStatus.CANCELLED;
    transfer.completedAt = new Date();
    const savedTransfer = await this.transferRepository.save(transfer);

    await this.auditService.log({
      action: AuditAction.CERTIFICATE_UPDATE,
      resourceType: AuditResourceType.CERTIFICATE,
      resourceId: transfer.certificateId,
      userId: user.id,
      ipAddress: ipAddress || 'unknown',
      metadata: {
        transferId: savedTransfer.id,
        operation: 'transfer_cancelled',
      },
      status: 'success',
    });

    return this.toTransferResponseDTO(savedTransfer);
  }

  async getTransferHistory(
    certificateId: string,
    user: { id: string; role: string; email?: string },
  ): Promise<TransferHistoryItemDTO[]> {
    const certificate = await this.certificateRepository.findOne({
      where: { id: certificateId },
    });

    if (!certificate) {
      throw new NotFoundException(
        `Certificate with ID ${certificateId} not found`,
      );
    }

    const transfers = await this.transferRepository.find({
      where: { certificateId },
      order: { initiatedAt: 'DESC' },
    });

    const isAdmin = user.role === UserRole.ADMIN;
    const isIssuer = certificate.issuerId === user.id;
    const isCurrentOwner =
      !!user.email && certificate.recipientEmail === user.email;
    const isNewOwner =
      !!user.email &&
      transfers.some(
        (t) => t.toEmail === user.email || t.fromEmail === user.email,
      );

    if (!isAdmin && !isIssuer && !isCurrentOwner && !isNewOwner) {
      throw new ForbiddenException(
        'You are not authorized to view the transfer history for this certificate',
      );
    }

    return transfers.map((t) => this.toTransferHistoryItemDTO(t));
  }

  async getPendingTransfers(email: string): Promise<TransferHistoryItemDTO[]> {
    const transfers = await this.transferRepository.find({
      where: [
        { toEmail: email, status: TransferStatus.PENDING },
        { fromEmail: email, status: TransferStatus.PENDING },
      ],
      order: { initiatedAt: 'DESC' },
    });

    return transfers.map((t) => this.toTransferHistoryItemDTO(t));
  }

  private async generateConfirmationCode(): Promise<string> {
    const maxRetries = 10;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const code = CryptoUtils.generateAlphanumericCode(
        CONFIRMATION_CODE_LENGTH,
      );
      const exists = await this.transferRepository.findOne({
        where: { confirmationCode: code },
        select: ['id'],
      });
      if (!exists) return code;
    }
    throw new ConflictException(
      'Failed to generate a unique confirmation code after multiple attempts',
    );
  }
}
