import { Test, TestingModule } from '@nestjs/testing';
import { CertificateService } from './certificate.service';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Certificate } from './entities/certificate.entity';
import { Verification } from './entities/verification.entity';
import { User } from '../users/entities/user.entity';
import { DuplicateDetectionService } from './services/duplicate-detection.service';
import { MetadataSchemaService } from '../metadata-schema/services/metadata-schema.service';
import { FilesService } from '../files/services/files.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { SorobanService } from '../stellar/services/soroban.service';

describe('CertificateService', () => {
  let service: CertificateService;
  const certificateRepository = {};
  const verificationRepository = {};
  const duplicateDetectionService = {};
  const webhooksService = {};
  const metadataSchemaService = {};
  const filesService = {
    generateAndUploadQrCode: jest.fn(),
  };
  const configService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificateService,
        {
          provide: getRepositoryToken(Certificate),
          useValue: certificateRepository,
        },
        {
          provide: getRepositoryToken(Verification),
          useValue: verificationRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: { findOne: jest.fn(), save: jest.fn() },
        },
        {
          provide: DuplicateDetectionService,
          useValue: duplicateDetectionService,
        },
        {
          provide: WebhooksService,
          useValue: webhooksService,
        },
        {
          provide: MetadataSchemaService,
          useValue: metadataSchemaService,
        },
        {
          provide: FilesService,
          useValue: filesService,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
        {
          provide: DataSource,
          useValue: { createQueryRunner: jest.fn(), transaction: jest.fn() },
        },
        {
          provide: SorobanService,
          useValue: { isConfigured: jest.fn().mockReturnValue(false), issueCertificate: jest.fn(), revokeCertificate: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<CertificateService>(CertificateService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should generate a QR code URL for a certificate', async () => {
    const certificate = {
      id: 'cert-123',
      verificationCode: 'AB12CD34',
    } as Certificate;

    jest.spyOn(service, 'findOne').mockResolvedValue(certificate);
    configService.get.mockReturnValue('http://localhost:5173');
    filesService.generateAndUploadQrCode.mockResolvedValue({
      qrUrl: 'https://storage.example.com/qr.png',
      qrKey: 'qr-key',
      qrBuffer: Buffer.from('qr'),
    });

    const result = await service.getCertificateQrCode('cert-123');

    // The service returns { id, verificationCode, verificationUrl, qrCode }
    expect(result).toHaveProperty('id', 'cert-123');
    expect(result).toHaveProperty('verificationCode', 'AB12CD34');
    expect(result).toHaveProperty('verificationUrl');
    expect(result).toHaveProperty('qrCode');
  });
});
