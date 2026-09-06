import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CertificateTransfer,
  TransferStatus,
} from '../entities/certificate-transfer.entity';
import { Certificate } from '../entities/certificate.entity';
import { InitiateTransferDto } from '../dto/transfer-certificate.dto';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction, AuditResourceType } from '../../audit/constants';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { LoggingService } from '../../../common/logging/logging.service';
import { UserRole } from '../../../common/constants/roles';
import { CryptoUtils } from '../../../common/utils/crypto.utils';

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
  ) {}

  async initiateTransfer(
    dto: InitiateTransferDto,
    initiator: { id: string; role: string },
    ipAddress?: string,
  ): Promise<CertificateTransfer> {
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

    // Notify the new owner
    await this.notificationsService.createNotification(
      initiator.id,
      NotificationType.INFO,
      'Certificate Transfer Initiated',
      `Transfer of certificate "${certificate.title}" to ${dto.newOwnerEmail} has been initiated. Confirmation code: ${confirmationCode}`,
    );

    this.logger.log(
      `Transfer initiated for certificate ${dto.certificateId} from ${certificate.recipientEmail} to ${dto.newOwnerEmail}`,
    );

    return savedTransfer;
  }

  async approveTransfer(
    transferId: string,
    confirmationCode: string,
    approver: { id: string; role: string },
    ipAddress?: string,
  ): Promise<CertificateTransfer> {
    const transfer = await this.transferRepository.findOne({
      where: { id: transferId },
      relations: ['certificate'],
    });

    if (!transfer) {
      throw new NotFoundException(`Transfer with ID ${transferId} not found`);
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

    if (
      transfer.confirmationCode &&
      transfer.confirmationCode !== confirmationCode
    ) {
      throw new ForbiddenException('Invalid confirmation code');
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

    // Notify both parties
    await this.notificationsService.createNotification(
      approver.id,
      NotificationType.SUCCESS,
      'Certificate Transfer Completed',
      `Certificate "${certificate.title}" has been successfully transferred to ${transfer.toEmail}.`,
    );

    this.logger.log(
      `Transfer ${transferId} approved for certificate ${transfer.certificateId}`,
    );

    return savedTransfer;
  }

  async rejectTransfer(
    transferId: string,
    rejectionReason: string,
    rejector: { id: string; role: string },
    ipAddress?: string,
  ): Promise<CertificateTransfer> {
    const transfer = await this.transferRepository.findOne({
      where: { id: transferId },
      relations: ['certificate'],
    });

    if (!transfer) {
      throw new NotFoundException(`Transfer with ID ${transferId} not found`);
    }

    if (transfer.status !== TransferStatus.PENDING) {
      throw new ConflictException(
        `Transfer is not pending. Current status: ${transfer.status}`,
      );
    }

    // Allow rejection if user is the initiator, the certificate's issuer, or an admin
    if (
      transfer.initiatedBy !== rejector.id &&
      transfer.certificate.issuerId !== rejector.id &&
      rejector.role !== UserRole.ADMIN
    ) {
      throw new ForbiddenException(
        'Only the transfer initiator, the certificate issuer, or an admin can reject this transfer request',
      );
    }

    transfer.status = TransferStatus.REJECTED;
    transfer.rejectionReason = rejectionReason;
    transfer.completedAt = new Date();
    const savedTransfer = await this.transferRepository.save(transfer);

    // Log audit entry
    await this.auditService.log({
      action: AuditAction.CERTIFICATE_UPDATE,
      resourceType: AuditResourceType.CERTIFICATE,
      resourceId: transfer.certificateId,
      userId: rejector.id,
      ipAddress: ipAddress || 'unknown',
      metadata: {
        transferId: savedTransfer.id,
        operation: 'transfer_rejected',
        rejectionReason,
      },
      status: 'success',
    });

    this.logger.log(`Transfer ${transferId} rejected`);

    return savedTransfer;
  }

  async cancelTransfer(
    transferId: string,
    canceller: { id: string; role: string },
    ipAddress?: string,
  ): Promise<CertificateTransfer> {
    const transfer = await this.transferRepository.findOne({
      where: { id: transferId },
      relations: ['certificate'],
    });

    if (!transfer) {
      throw new NotFoundException(`Transfer with ID ${transferId} not found`);
    }

    if (transfer.status !== TransferStatus.PENDING) {
      throw new ConflictException(
        `Transfer is not pending. Current status: ${transfer.status}`,
      );
    }

    // Allow cancellation if user is the initiator, the certificate's issuer, or an admin
    if (
      transfer.initiatedBy !== canceller.id &&
      transfer.certificate.issuerId !== canceller.id &&
      canceller.role !== UserRole.ADMIN
    ) {
      throw new ForbiddenException(
        'Only the transfer initiator, the certificate issuer, or an admin can cancel this transfer request',
      );
    }

    transfer.status = TransferStatus.CANCELLED;
    transfer.completedAt = new Date();
    const savedTransfer = await this.transferRepository.save(transfer);

    await this.auditService.log({
      action: AuditAction.CERTIFICATE_UPDATE,
      resourceType: AuditResourceType.CERTIFICATE,
      resourceId: transfer.certificateId,
      userId: canceller.id,
      ipAddress: ipAddress || 'unknown',
      metadata: {
        transferId: savedTransfer.id,
        operation: 'transfer_cancelled',
      },
      status: 'success',
    });

    return savedTransfer;
  }

  async getTransferHistory(
    certificateId: string,
  ): Promise<CertificateTransfer[]> {
    return this.transferRepository.find({
      where: { certificateId },
      order: { initiatedAt: 'DESC' },
    });
  }

  async getPendingTransfers(userEmail: string): Promise<CertificateTransfer[]> {
    return this.transferRepository.find({
      where: [
        { fromEmail: userEmail, status: TransferStatus.PENDING },
        { toEmail: userEmail, status: TransferStatus.PENDING },
      ],
      relations: ['certificate'],
      order: { initiatedAt: 'DESC' },
    });
  }

  private async generateConfirmationCode(): Promise<string> {
    const maxRetries = 10;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const code = CryptoUtils.generateAlphanumericCode(6);
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
