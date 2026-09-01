import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { LoggingService } from '../../common/logging/logging.service';

describe('EmailService', () => {
  let service: EmailService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config = {
                EMAIL_FROM: 'test@example.com',
                EMAIL_HOST: 'smtp.test.com',
                EMAIL_PORT: 587,
                EMAIL_USERNAME: 'user',
                EMAIL_PASSWORD: 'pass',
                APP_URL: 'http://localhost:3000',
              };
              return config[key];
            }),
          },
        },
        {
          provide: LoggingService,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendCertificateIssued', () => {
    it('should send certificate issued email', async () => {
      const dto = {
        to: 'recipient@example.com',
        certificateId: '123',
        recipientName: 'John Doe',
        certificateName: 'AWS Certificate',
        issuerName: 'AWS Academy',
      };

      const sendEmailSpy = jest
        .spyOn(service, 'sendEmail')
        .mockResolvedValue(undefined);

      await service.sendCertificateIssued(dto);

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: dto.to,
          template: 'certificate-issued',
          subject: expect.stringContaining('Certificate Issued'),
        }),
      );
    });
  });

  describe('sendVerificationEmail', () => {
    it('should send verification email', async () => {
      const dto = {
        to: 'user@example.com',
        userName: 'John Doe',
        verificationLink: 'http://localhost:3000/verify?token=abc123',
      };

      const sendEmailSpy = jest
        .spyOn(service, 'sendEmail')
        .mockResolvedValue(undefined);

      await service.sendVerificationEmail(dto);

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: dto.to,
          template: 'verification-email',
          subject: 'Verify Your Email Address',
        }),
      );
    });
  });

  describe('sendPasswordReset', () => {
    it('should send password reset email', async () => {
      const dto = {
        to: 'user@example.com',
        userName: 'John Doe',
        resetLink: 'http://localhost:3000/reset?token=xyz789',
      };

      const sendEmailSpy = jest
        .spyOn(service, 'sendEmail')
        .mockResolvedValue(undefined);

      await service.sendPasswordReset(dto);

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: dto.to,
          template: 'password-reset',
          subject: 'Reset Your Password',
        }),
      );
    });
  });

  describe('sendRevocationNotice', () => {
    it('should send revocation notice email', async () => {
      const dto = {
        to: 'recipient@example.com',
        recipientName: 'John Doe',
        certificateId: '123',
        certificateName: 'AWS Certificate',
        reason: 'User request',
        revocationDate: new Date().toISOString(),
      };

      const sendEmailSpy = jest
        .spyOn(service, 'sendEmail')
        .mockResolvedValue(undefined);

      await service.sendRevocationNotice(dto);

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: dto.to,
          template: 'revocation-notice',
          subject: expect.stringContaining('Certificate Revoked'),
        }),
      );
    });
  });

  describe('verifyConnection', () => {
    it('should return true when the transport verifies', async () => {
      // Stub the transporter so the test does not attempt a real SMTP round-trip
      // (which hangs and times out in the test environment).
      (
        service as unknown as { transporter: { verify: jest.Mock } }
      ).transporter = { verify: jest.fn().mockResolvedValue(true) };
      const result = await service.verifyConnection();
      expect(typeof result).toBe('boolean');
      expect(result).toBe(true);
    });

    it('should return false when the transport fails to verify', async () => {
      (
        service as unknown as { transporter: { verify: jest.Mock } }
      ).transporter = {
        verify: jest.fn().mockRejectedValue(new Error('smtp unavailable')),
      };
      const result = await service.verifyConnection();
      expect(result).toBe(false);
    });
  });
});
