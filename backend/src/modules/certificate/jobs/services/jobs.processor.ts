import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Certificate } from '../../entities/certificate.entity';
import { CertificateStatus } from '../../constants/certificate-status.enum';
import { WebhooksService } from '../../../webhooks/webhooks.service';
import { WebhookEvent } from '../../../webhooks/entities/webhook-subscription.entity';
import { LoggingService } from '../../../../common/logging/logging.service';

@Processor('certificate-jobs')
export class JobsProcessor {
  constructor(
    @InjectRepository(Certificate)
    private readonly certificateRepository: Repository<Certificate>,
    private readonly webhooksService: WebhooksService,
    private readonly logger: LoggingService,
  ) {}

  @Process('send-email')
  handleEmail(job: Job) {
    this.logger.log(`Sending email with payload: ${JSON.stringify(job.data)}`);
    // integrate with email service
  }

  @Process('generate-pdf')
  handlePdf(job: Job) {
    this.logger.log(`Generating PDF with payload: ${JSON.stringify(job.data)}`);
    // integrate with PDF generator
  }

  @Process('expiration-check')
  async handleExpiration(job: Job) {
    this.logger.log(`Running expiration check...`);

    const expiryWindowDays = parseInt(
      process.env.CERTIFICATE_EXPIRY_WINDOW_DAYS || '0',
      10,
    );
    const sequenceThreshold = process.env.STELLAR_SEQUENCE_THRESHOLD
      ? parseInt(process.env.STELLAR_SEQUENCE_THRESHOLD, 10)
      : undefined;

    const now = new Date();
    const query = this.certificateRepository
      .createQueryBuilder('certificate')
      .where('certificate.status = :status', { status: 'active' })
      .andWhere('certificate.expiresAt <= :now', { now });

    if (sequenceThreshold) {
      query.orWhere(
        "(certificate.metadata->>'stellarSequence')::bigint <= :sequenceThreshold",
        { sequenceThreshold },
      );
    }

    if (expiryWindowDays > 0) {
      const windowDate = new Date(
        now.getTime() - expiryWindowDays * 24 * 60 * 60 * 1000,
      );
      query.andWhere('certificate.expiresAt >= :windowDate', {
        windowDate,
      });
    }

    const expiredCertificates = await query.getMany();

    if (expiredCertificates.length === 0) {
      this.logger.log('No certificates to expire.');
      return;
    }

    for (const cert of expiredCertificates) {
      cert.status = CertificateStatus.EXPIRED;
      await this.certificateRepository.save(cert);

      try {
        await this.webhooksService.triggerEvent(
          WebhookEvent.CERTIFICATE_EXPIRED,
          cert.issuerId,
          {
            id: cert.id,
            status: cert.status,
            expiredAt: now,
          },
        );
      } catch (err) {
        this.logger.error(
          `Failed to emit expiry event for certificate ${cert.id}:`,
          err,
        );
      }
      this.logger.log(`Certificate expired: ${cert.id}`);
    }
  }
}
