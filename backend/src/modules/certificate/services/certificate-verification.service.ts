import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Certificate } from '../entities/certificate.entity';
import { Verification } from '../entities/verification.entity';
import { WebhooksService } from '../../webhooks/webhooks.service';
import { WebhookEvent } from '../../webhooks/entities/webhook-subscription.entity';

@Injectable()
export class CertificateVerificationService {
  private readonly logger = new Logger(CertificateVerificationService.name);

  constructor(
    @InjectRepository(Certificate)
    private readonly certificateRepository: Repository<Certificate>,
    @InjectRepository(Verification)
    private readonly verificationRepository: Repository<Verification>,
    private readonly webhooksService: WebhooksService,
  ) {}

  async findByVerificationCode(verificationCode: string): Promise<Certificate> {
    const certificate = await this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .where('certificate.verificationCode = :verificationCode', {
        verificationCode,
      })
      .andWhere('certificate.status = :status', { status: 'active' })
      .getOne();

    if (!certificate) {
      throw new NotFoundException(
        'Certificate not found or invalid verification code',
      );
    }

    return certificate;
  }

  async verifyCertificate(verificationCode: string): Promise<Certificate> {
    try {
      const certificate = await this.findByVerificationCode(verificationCode);

      // Record successful verification
      await this.verificationRepository.save({
        certificate,
        success: true,
        verifiedAt: new Date(),
      });

      this.logger.log(
        `Certificate verified: ${certificate.id} with code: ${verificationCode}`,
      );

      // Trigger webhook event
      await this.webhooksService.triggerEvent(
        WebhookEvent.CERTIFICATE_VERIFIED,
        certificate.issuerId,
        {
          id: certificate.id,
          verificationCode,
          verifiedAt: new Date(),
          recipientEmail: certificate.recipientEmail,
        },
      );

      return certificate;
    } catch (error) {
      if (error instanceof NotFoundException) {
        // Option: Record failed verification in DB too
        this.logger.warn(
          `Failed verification attempt with code: ${verificationCode}`,
        );
      }
      throw error;
    }
  }

  async getVerificationHistory(certificateId: string): Promise<Verification[]> {
    return this.verificationRepository.find({
      where: { certificate: { id: certificateId } as any },
      order: { verifiedAt: 'DESC' },
    });
  }
}
