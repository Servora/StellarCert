import { Test, TestingModule } from '@nestjs/testing';
import { CertificateController } from './certificate.controller';
import { CertificateService } from './certificate.service';
import { CertificateStatsService } from './services/stats.service';
import { CertificatePdfService } from './services/pdf.service';
import { CertificateMapper } from './mappers/certificate.mapper';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { IpRateLimitGuard } from '../../common/guards/ip-rate-limit.guard';

describe('CertificateController', () => {
  let controller: CertificateController;
  const certificateService = {
    getCertificateQrCode: jest.fn(),
    verifyCertificate: jest.fn(),
  };
  const statsService = {
    getPublicSummary: jest.fn(),
  };
  const pdfService = {
    generate: jest.fn(),
  };
  const mapper = {
    toResponse: jest.fn((c: any) => c),
    toVerificationResult: jest.fn((c: any, code: string) => ({ ...c, verificationCode: code })),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CertificateController],
      providers: [
        {
          provide: CertificateService,
          useValue: certificateService,
        },
        {
          provide: CertificateStatsService,
          useValue: statsService,
        },
        {
          provide: CertificatePdfService,
          useValue: pdfService,
        },
        {
          provide: CertificateMapper,
          useValue: mapper,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(IpRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CertificateController>(CertificateController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate QR code generation to the service', async () => {
    const response = {
      certificateId: 'cert-123',
      verificationCode: 'AB12CD34',
      verificationUrl: 'https://stellarcert.app/verify?serial=AB12CD34',
      qrUrl: 'https://storage.example.com/qr.png',
    };

    certificateService.getCertificateQrCode.mockResolvedValue(response);

    await expect(controller.getQrCode('cert-123')).resolves.toEqual(response);
    expect(certificateService.getCertificateQrCode).toHaveBeenCalledWith(
      'cert-123',
    );
  });

  it('should verify certificate with verification code', async () => {
    const mockCertificate = {
      id: 'cert-123',
      title: 'Test Certificate',
      recipientName: 'John Doe',
      recipientEmail: 'john@example.com',
      status: 'active',
      issuedAt: new Date('2024-01-01'),
      expiresAt: new Date('2025-01-01'),
      issuer: {
        name: 'Test Issuer',
        website: 'https://issuer.com',
      },
      verificationCode: 'AB12CD34',
    };

    // The controller method is verifyByCode, not verifyCertificate.
    // certificateService.verifyByCode is called internally by the controller.
    const verifyByCodeMock = jest.fn().mockResolvedValue(mockCertificate);
    (certificateService as any).verifyByCode = verifyByCodeMock;

    const mockReq = {
      headers: { 'x-forwarded-for': '127.0.0.1' },
      ip: '127.0.0.1',
    } as any;

    await expect(
      controller.verifyByCode('AB12CD34', mockReq),
    ).resolves.toBeDefined();
  });
});
