import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Certificate } from '../../entities/certificate.entity';
import { CertificateStatus } from '../../constants/certificate-status.enum';
import { WebhooksService } from '../../../webhooks/webhooks.service';
import { WebhookEvent } from '../../../webhooks/entities/webhook-subscription.entity';
import { LoggingService } from '../../../../common/logging/logging.service';
import { EmailService } from '../../../email/email.service';
import { CertificatePdfService } from '../../services/pdf.service';

@Processor('certificate-jobs')
export class JobsProcessor {
  constructor(
    @InjectRepository(Certificate)
    private readonly certificateRepository: Repository<Certificate>,
    private readonly webhooksService: WebhooksService,
    private readonly logger: LoggingService,
    private readonly emailService: EmailService,
    private readonly pdfService: CertificatePdfService,
  ) {}

  @Process('send-email')
  async handleEmail(job: Job) {
    this.logger.log(`Sending email with payload: ${JSON.stringify(job.data)}`);
    await this.emailService.sendEmail({
      to: job.data.recipientEmail,
      subject: job.data.subject,
      template: 'certificate-issued',
      data: job.data.metadata || { body: job.data.body },
    });
  }

  @Process('generate-pdf')
  async handlePdf(job: Job) {
    this.logger.log(`Generating PDF with payload: ${JSON.stringify(job.data)}`);
    const certificate = await this.certificateRepository.findOne({
      where: { id: job.data.certificateId },
    });
    if (certificate) {
      await this.pdfService.generate(certificate);
      this.logger.log(`PDF generated for certificate: ${certificate.id}`);
    } else {
      this.logger.warn(`Certificate not found: ${job.data.certificateId}`);
    }
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
    let query = this.certificateRepository
      .createQueryBuilder('certificate')
      .where('certificate.status = :status', { status: 'active' });

    // The sequence-threshold alternative must be grouped with the expiry
    // condition (not or-joined at the top level), otherwise every certificate
    // matching the sequence condition — including REVOKED and FROZEN ones —
    // would be selected and marked EXPIRED regardless of its status.
    if (sequenceThreshold) {
      query = query.andWhere(
        new Brackets((qb) => {
          qb.where('certificate.expiresAt <= :now', { now }).orWhere(
            "(certificate.metadata->>'stellarSequence')::bigint <= :sequenceThreshold",
            { sequenceThreshold },
          );
        }),
      );
    } else {
      query = query.andWhere('certificate.expiresAt <= :now', { now });
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
