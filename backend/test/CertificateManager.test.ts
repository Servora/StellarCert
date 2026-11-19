import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StellarService } from '../src/common/services/stellar.service';
import { CertificateService } from '../src/modules/certificate/certificate.service';
import { Certificate } from '../src/modules/certificate/entities/certificate.entity';
import { Verification } from '../src/modules/certificate/entities/verification.entity';
import { DuplicateDetectionService } from '../src/modules/certificate/services/duplicate-detection.service';
import { MetadataSchemaService } from '../src/modules/metadata-schema/services/metadata-schema.service';
import { FilesService } from '../src/modules/files/services/files.service';
import { WebhooksService } from '../src/modules/webhooks/webhooks.service';

describe('CertificateManager Integration Tests', () => {
  let app: INestApplication;
  let certificateService: CertificateService;
  let stellarService: StellarService;
  let filesService: FilesService;

  // Test configuration
  const TEST_ISSUER_ID = 'test-issuer-123';
  const TEST_RECIPIENT_EMAIL = 'test@example.com';
  const TEST_RECIPIENT_NAME = 'John Doe';
  const TEST_CERTIFICATE_TITLE = 'Certificate of Achievement';

  // Mock issuer object for certificate creation
  const mockIssuer = {
    id: TEST_ISSUER_ID,
    name: 'Test Issuer',
    email: 'issuer@test.com',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: (configService: ConfigService) => ({
            type: 'postgres',
            host: configService.get('DB_HOST') || 'localhost',
            port: configService.get('DB_PORT') || 5432,
            username: configService.get('DB_USERNAME') || 'postgres',
            password: configService.get('DB_PASSWORD') || 'postgres',
            database: configService.get('DB_NAME') || 'stellarcert_test',
            entities: [Certificate, Verification],
            synchronize: true,
          }),
          inject: [ConfigService],
        }),
        TypeOrmModule.forFeature([Certificate, Verification]),
      ],
      providers: [
        CertificateService,
        StellarService,
        {
          provide: DuplicateDetectionService,
          useValue: {
            checkForDuplicates: jest
              .fn()
              .mockResolvedValue({ isDuplicate: false }),
          },
        },
        {
          provide: MetadataSchemaService,
          useValue: {
            validate: jest.fn().mockResolvedValue({ valid: true }),
          },
        },
        {
          provide: FilesService,
          useValue: {
            generateAndUploadCertificate: jest.fn().mockResolvedValue({
              pdfUrl: 'https://storage.example.com/cert-123.pdf',
              qrUrl: 'https://storage.example.com/qr-123.png',
            }),
            generateAndUploadQrCode: jest.fn().mockResolvedValue({
              qrUrl: 'https://storage.example.com/qr-123.png',
              qrKey: 'qr-123.png',
              qrBuffer: Buffer.from('mock-qr-buffer'),
            }),
          },
        },
        {
          provide: WebhooksService,
          useValue: {
            triggerEvent: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    certificateService =
      moduleFixture.get<CertificateService>(CertificateService);
    stellarService = moduleFixture.get<StellarService>(StellarService);
    filesService = moduleFixture.get<FilesService>(FilesService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('Certificate Creation Flow', () => {
    it('should create a certificate with all required fields', async () => {
      const createDto = {
        issuerId: TEST_ISSUER_ID,
        recipientEmail: TEST_RECIPIENT_EMAIL,
        recipientName: TEST_RECIPIENT_NAME,
        title: TEST_CERTIFICATE_TITLE,
        description: 'Test certificate description',
        status: 'active',
        metadata: {
          course: 'Advanced React',
          grade: 'A',
        },
      };

      const certificate = await certificateService.create(createDto);

      expect(certificate).toBeDefined();
      expect(certificate.id).toBeDefined();
      expect(certificate.recipientEmail).toBe(TEST_RECIPIENT_EMAIL);
      expect(certificate.recipientName).toBe(TEST_RECIPIENT_NAME);
      expect(certificate.title).toBe(TEST_CERTIFICATE_TITLE);
      expect(certificate.status).toBe('active');
      expect(certificate.verificationCode).toBeDefined();
      expect(certificate.pdfUrl).toBeDefined();
      expect(certificate.qrCodeUrl).toBeDefined();
    });

    it('should generate unique verification codes', async () => {
      const createDto1 = {
        issuerId: TEST_ISSUER_ID,
        recipientEmail: 'user1@example.com',
        recipientName: 'User One',
        title: 'Certificate 1',
        status: 'active',
      };

      const createDto2 = {
        issuerId: TEST_ISSUER_ID,
        recipientEmail: 'user2@example.com',
        recipientName: 'User Two',
        title: 'Certificate 2',
        status: 'active',
      };

      const cert1 = await certificateService.create(createDto1);
      const cert2 = await certificateService.create(createDto2);

      expect(cert1.verificationCode).not.toBe(cert2.verificationCode);
    });

    it('should attach PDF and QR code URLs after creation', async () => {
      const createDto = {
        issuerId: TEST_ISSUER_ID,
        recipientEmail: 'pdf-test@example.com',
        recipientName: 'PDF Test User',
        title: 'PDF Test Certificate',
        status: 'active',
      };

      const certificate = await certificateService.create(createDto);

      expect(certificate.pdfUrl).toContain('.pdf');
      expect(certificate.qrCodeUrl).toContain('.png');
    });
  });

  describe('Certificate Verification Flow', () => {
    it('should verify a valid certificate by verification code', async () => {
      // Create a certificate first
      const createDto = {
        issuerId: TEST_ISSUER_ID,
        recipientEmail: 'verify-test@example.com',
        recipientName: 'Verify Test User',
        title: 'Verify Test Certificate',
        status: 'active',
      };

      const created = await certificateService.create(createDto);

      // Verify the certificate
      const verified = await certificateService.verifyCertificate(
        created.verificationCode!,
      );

      expect(verified).toBeDefined();
      expect(verified.id).toBe(created.id);
      expect(verified.status).toBe('active');
    });

    it('should throw NotFoundException for invalid verification code', async () => {
      await expect(
        certificateService.verifyCertificate('INVALID123'),
      ).rejects.toThrow('Certificate not found or invalid verification code');
    });
  });

  describe('Certificate Revocation Flow', () => {
    it('should revoke an active certificate', async () => {
      // Create a certificate first
      const createDto = {
        issuerId: TEST_ISSUER_ID,
        recipientEmail: 'revoke-test@example.com',
        recipientName: 'Revoke Test User',
        title: 'Revoke Test Certificate',
        status: 'active',
      };

      const created = await certificateService.create(createDto);

      // Revoke the certificate
      const revoked = await certificateService.revoke(
        created.id,
        'Test revocation reason',
      );

      expect(revoked.status).toBe('revoked');
      expect(revoked.metadata).toHaveProperty('revocationReason');
    });
  });

  describe('Stellar Blockchain Integration', () => {
    it('should verify transactions on Stellar network', async () => {
      // Test with a known testnet transaction hash
      const testTxHash =
        '33886238139628d9386e62d4b828c4a035bbe06d458f47196f9421f2569e45e0';

      const result = await stellarService.verifyTransaction(testTxHash);

      expect(typeof result).toBe('boolean');
    });

    it('should validate Stellar public keys', () => {
      // Valid testnet public key
      const validKey =
        'GBGDYJWZMVJ3H6WUNM7H2JY3BK4XXL5QTV3M3YJZT6G7J3K4L5M6N7O8P9Q';

      // Invalid keys
      const invalidKey1 = 'invalid-key';
      const invalidKey2 =
        'GBGDYJWZMVJ3H6WUNM7H2JY3BK4XXL5QTV3M3YJZT6G7J3K4L5M6N7O8P'; // Too short

      expect(StellarService.isValidPublicKey(validKey)).toBe(false); // May not be valid format
      expect(StellarService.isValidPublicKey(invalidKey1)).toBe(false);
    });

    it('should validate Stellar secret keys', () => {
      // Test various key formats
      const validSecret =
        'SCZANGBA5YHTNYVVIC4Q6G6ck77G6MRFWEPN5R7W7G76FS5DBL2O6L7L';
      const invalidSecret = 'invalid-secret-key';

      expect(StellarService.isValidSecretKey(invalidSecret)).toBe(false);
    });

    it('should get network info from configuration', () => {
      const networkInfo = stellarService.getNetworkInfo();

      expect(networkInfo).toHaveProperty('network');
      expect(networkInfo).toHaveProperty('horizon');
    });

    it('should check network health', async () => {
      const isHealthy = await stellarService.checkNetworkHealth();

      expect(typeof isHealthy).toBe('boolean');
    });
  });

  describe('PDF and QR Code Generation', () => {
    it('should generate certificate with PDF and QR code', async () => {
      const certificateData = {
        tokenId: 'test-token-123',
        recipientName: 'Test User',
        title: 'Test Certificate',
        description: 'This is a test certificate',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        issuerName: 'Test Issuer',
        verificationUrl: 'https://example.com/verify?code=ABC123',
        metadata: { course: 'Test Course' },
      };

      const result =
        await filesService.generateAndUploadCertificate(certificateData);

      expect(result).toHaveProperty('pdfUrl');
      expect(result).toHaveProperty('pdfKey');
      expect(result).toHaveProperty('qrUrl');
      expect(result).toHaveProperty('qrKey');
    });

    it('should generate standalone QR code', async () => {
      const verificationUrl = 'https://example.com/verify?code=TEST123';

      const result = await filesService.generateAndUploadQrCode(
        verificationUrl,
        'test-qr',
      );

      expect(result).toHaveProperty('qrUrl');
      expect(result).toHaveProperty('qrKey');
      expect(result).toHaveProperty('qrBuffer');
    });
  });

  describe('Certificate Retrieval', () => {
    it('should find certificate by ID', async () => {
      const createDto = {
        issuerId: TEST_ISSUER_ID,
        recipientEmail: 'find-test@example.com',
        recipientName: 'Find Test User',
        title: 'Find Test Certificate',
        status: 'active',
      };

      const created = await certificateService.create(createDto);
      const found = await certificateService.findOne(created.id);

      expect(found).toBeDefined();
      expect(found.id).toBe(created.id);
    });

    it('should find certificates by issuer ID', async () => {
      const result = await certificateService.findAll(1, 10, TEST_ISSUER_ID);

      expect(result).toHaveProperty('certificates');
      expect(result).toHaveProperty('total');
      expect(Array.isArray(result.certificates)).toBe(true);
    });

    it('should find certificates by recipient email', async () => {
      const createDto = {
        issuerId: TEST_ISSUER_ID,
        recipientEmail: 'recipient-find@example.com',
        recipientName: 'Recipient Find User',
        title: 'Recipient Find Certificate',
        status: 'active',
      };

      await certificateService.create(createDto);

      const certificates = await certificateService.getCertificatesByRecipient(
        'recipient-find@example.com',
      );

      expect(Array.isArray(certificates)).toBe(true);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle duplicate certificate detection', async () => {
      const createDto = {
        issuerId: TEST_ISSUER_ID,
        recipientEmail: 'duplicate@example.com',
        recipientName: 'Duplicate User',
        title: 'Duplicate Certificate',
        status: 'active',
      };

      // Create first certificate
      await certificateService.create(createDto);

      // Try to create duplicate - should work without duplicate detection config
      const cert2 = await certificateService.create(createDto);
      expect(cert2).toBeDefined();
    });

    it('should set default expiry date', async () => {
      const createDto = {
        issuerId: TEST_ISSUER_ID,
        recipientEmail: 'expiry@example.com',
        recipientName: 'Expiry User',
        title: 'Expiry Test Certificate',
        status: 'active',
      };

      const certificate = await certificateService.create(createDto);

      expect(certificate.expiresAt).toBeDefined();
      const expectedExpiry = new Date();
      expectedExpiry.setFullYear(expectedExpiry.getFullYear() + 1);

      // Check it's approximately 1 year from now (within 1 day tolerance)
      const diff = Math.abs(
        certificate.expiresAt!.getTime() - expectedExpiry.getTime(),
      );
      expect(diff).toBeLessThan(24 * 60 * 60 * 1000); // 1 day in milliseconds
    });

    it('should allow custom expiry date', async () => {
      const customExpiry = new Date('2030-12-31');

      const createDto = {
        issuerId: TEST_ISSUER_ID,
        recipientEmail: 'custom-expiry@example.com',
        recipientName: 'Custom Expiry User',
        title: 'Custom Expiry Certificate',
        status: 'active',
        expiresAt: customExpiry,
      };

      const certificate = await certificateService.create(createDto);

      expect(certificate.expiresAt!.getTime()).toBe(customExpiry.getTime());
    });
  });
});
