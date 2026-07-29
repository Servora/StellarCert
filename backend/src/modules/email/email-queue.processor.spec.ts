import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from './email.service';
import { EmailQueueProcessor } from './email-queue.processor';
import { LoggingService } from '../../common/logging/logging.service';

describe('EmailQueueProcessor', () => {
  let processor: EmailQueueProcessor;
  let emailService: EmailService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailQueueProcessor,
        {
          provide: EmailService,
          useValue: {
            sendEmail: jest.fn(),
            sendCertificateIssued: jest.fn(),
            sendVerificationEmail: jest.fn(),
            sendPasswordReset: jest.fn(),
            sendRevocationNotice: jest.fn(),
          },
        },
        {
          provide: LoggingService,
          useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        },
      ],
    }).compile();

    processor = module.get<EmailQueueProcessor>(EmailQueueProcessor);
    emailService = module.get<EmailService>(EmailService);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('processSendEmail', () => {
    it('should process send email job', async () => {
      const jobData = {
        to: 'test@example.com',
        subject: 'Test',
        template: 'verification-email',
        data: {},
      };

      const job = {
        id: 1,
        data: jobData,
      };

      jest.spyOn(emailService, 'sendEmail').mockResolvedValue(undefined);

      await processor.processSendEmail(job as any);

      expect(emailService.sendEmail).toHaveBeenCalledWith(jobData);
    });
  });

  describe('processCertificateIssued', () => {
    it('should process certificate issued job', async () => {
      const jobData = {
        to: 'test@example.com',
        certificateId: '123',
        recipientName: 'John',
        certificateName: 'Test Cert',
        issuerName: 'Test Issuer',
      };

      const job = {
        id: 1,
        data: jobData,
      };

      jest
        .spyOn(emailService, 'sendCertificateIssued')
        .mockResolvedValue(undefined);

      await processor.processCertificateIssued(job as any);

      expect(emailService.sendCertificateIssued).toHaveBeenCalledWith(jobData);
    });
  });

  describe('processVerificationEmail', () => {
    it('should process verification email job', async () => {
      const jobData = {
        to: 'test@example.com',
        userName: 'John',
        verificationLink: 'http://localhost:3000/verify?token=abc',
      };

      const job = {
        id: 1,
        data: jobData,
      };

      jest
        .spyOn(emailService, 'sendVerificationEmail')
        .mockResolvedValue(undefined);

      await processor.processVerificationEmail(job as any);

      expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(jobData);
    });
  });

  describe('processPasswordReset', () => {
    it('should process password reset job', async () => {
      const jobData = {
        to: 'test@example.com',
        userName: 'John',
        resetLink: 'http://localhost:3000/reset?token=xyz',
      };

      const job = {
        id: 1,
        data: jobData,
      };

      jest
        .spyOn(emailService, 'sendPasswordReset')
        .mockResolvedValue(undefined);

      await processor.processPasswordReset(job as any);

      expect(emailService.sendPasswordReset).toHaveBeenCalledWith(jobData);
    });
  });

  describe('processRevocationNotice', () => {
    it('should process revocation notice job', async () => {
      const jobData = {
        to: 'test@example.com',
        recipientName: 'John',
        certificateId: '123',
        certificateName: 'Test Cert',
        reason: 'User request',
        revocationDate: new Date().toISOString(),
      };

      const job = {
        id: 1,
        data: jobData,
      };

      jest
        .spyOn(emailService, 'sendRevocationNotice')
        .mockResolvedValue(undefined);

      await processor.processRevocationNotice(job as any);

      expect(emailService.sendRevocationNotice).toHaveBeenCalledWith(jobData);
    });
  });
});
