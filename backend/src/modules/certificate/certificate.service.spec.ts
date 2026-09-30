import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { CertificateService } from './certificate.service';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Certificate } from './entities/certificate.entity';
import { CertificateStatus } from './constants/certificate-status.enum';
import { Verification } from './entities/verification.entity';
import { User } from '../users/entities/user.entity';
import { DuplicateDetectionService } from './services/duplicate-detection.service';
import { MetadataSchemaService } from '../metadata-schema/services/metadata-schema.service';
import { FilesService } from '../files/services/files.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { WebhookEvent } from '../webhooks/entities/webhook-subscription.entity';
import { SorobanService } from '../stellar/services/soroban.service';
import { UserRole } from '../users/entities/user.entity';
import { MAX_EXPORT_LIMIT, MAX_PAGE_LIMIT } from './dto/export-filters.dto';

describe('CertificateService', () => {
  let service: CertificateService;
  const mockQueryBuilder = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(0),
    getMany: jest.fn().mockResolvedValue([]),
    getOne: jest.fn().mockResolvedValue(null),
  };
  const certificateRepository = {
    update: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
  };
  const verificationRepository = {};
  const duplicateDetectionService = {};
  const webhooksService = {
    triggerEvent: jest.fn(),
  };
  const metadataSchemaService = {};
  const filesService = {
    generateAndUploadQrCode: jest.fn(),
  };
  const configService = {
    get: jest.fn(),
  };
  const sorobanService = {
    isConfigured: jest.fn().mockReturnValue(false),
    issueCertificate: jest.fn(),
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
          useValue: {},
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
          useValue: {},
        },
        {
          provide: SorobanService,
          useValue: sorobanService,
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
    const originalFrontendUrl = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://stellarcert.app';

    try {
      const result = await service.getCertificateQrCode('cert-123');

      expect(result).toEqual({
        id: 'cert-123',
        verificationCode: 'AB12CD34',
        verificationUrl: 'https://stellarcert.app/verify/AB12CD34',
        qrCode: expect.any(String),
      });
      expect(result.qrCode).toContain('data:image/png;base64,');
    } finally {
      if (originalFrontendUrl === undefined) {
        delete process.env.FRONTEND_URL;
      } else {
        process.env.FRONTEND_URL = originalFrontendUrl;
      }
    }
  });

  describe('findAll limit capping and scoping', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should cap limit at MAX_PAGE_LIMIT (100) when limit exceeds 100', async () => {
      await service.findAll(1, 250, 'issuer-1', 'active');

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_PAGE_LIMIT);
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.issuerId = :issuerId',
        { issuerId: 'issuer-1' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.status = :status',
        { status: 'active' },
      );
    });

    it('should use provided limit when within acceptable range', async () => {
      await service.findAll(2, 25);

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(25);
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(25);
    });
  });

  describe('exportCertificates scoping and limits', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should force non-admin issuer to their own currentUserId', async () => {
      await service.exportCertificates(
        'other-issuer-id',
        'active',
        undefined,
        'my-issuer-id',
        UserRole.ISSUER,
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.issuerId = :issuerId',
        { issuerId: 'my-issuer-id' },
      );
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_EXPORT_LIMIT);
    });

    it('should allow admin to export any issuer certificates', async () => {
      await service.exportCertificates(
        'other-issuer-id',
        'active',
        undefined,
        'admin-id',
        UserRole.ADMIN,
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.issuerId = :issuerId',
        { issuerId: 'other-issuer-id' },
      );
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_EXPORT_LIMIT);
    });

    it('should cap requested limit at MAX_EXPORT_LIMIT', async () => {
      await service.exportCertificates(
        undefined,
        undefined,
        5000,
        'admin-id',
        UserRole.ADMIN,
      );

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_EXPORT_LIMIT);
    });
  });

  describe('bulkExport scoping and limits', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockQueryBuilder.getMany.mockResolvedValue([
        {
          id: 'cert-1',
          recipientName: 'Alice',
          recipientEmail: 'alice@example.com',
          title: 'Cert 1',
          courseName: 'Course 1',
          issuedAt: new Date('2026-01-01'),
          status: 'active',
        },
      ]);
    });

    it('should force non-admin issuer to their own issuerId and filter certificates', async () => {
      await service.bulkExport(
        ['cert-1', 'cert-2'],
        { issuerId: 'attacker-target-id', status: 'active' },
        'my-issuer-id',
        UserRole.ISSUER,
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.issuerId = :issuerId',
        { issuerId: 'my-issuer-id' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.id IN (:...certificateIds)',
        { certificateIds: ['cert-1', 'cert-2'] },
      );
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_EXPORT_LIMIT);
    });

    it('should allow admin to filter by target issuerId', async () => {
      await service.bulkExport(
        [],
        { issuerId: 'target-issuer-id' },
        'target-issuer-id',
        UserRole.ADMIN,
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.issuerId = :issuerId',
        { issuerId: 'target-issuer-id' },
      );
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_EXPORT_LIMIT);
    });
  });

  describe('exportAllFiltered scoping and limits', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockQueryBuilder.getMany.mockResolvedValue([]);
    });

    it('should force non-admin issuer to their own issuerId', async () => {
      await service.exportAllFiltered(
        { issuerId: 'attacker-target-id', status: 'active' },
        'my-issuer-id',
        UserRole.ISSUER,
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.issuerId = :issuerId',
        { issuerId: 'my-issuer-id' },
      );
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_EXPORT_LIMIT);
    });

    it('should allow admin to export all certificates across issuers without issuerId filter', async () => {
      await service.exportAllFiltered(
        { status: 'active' },
        undefined,
        UserRole.ADMIN,
      );

      const calls = mockQueryBuilder.andWhere.mock.calls;
      const issuerCalls = calls.filter((c: any[]) => c[0].includes('issuerId'));
      expect(issuerCalls).toHaveLength(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_EXPORT_LIMIT);
    });
  });

  describe('syncChain (#733)', () => {
    let certificate: Certificate;

    beforeEach(() => {
      jest.clearAllMocks();
      sorobanService.isConfigured.mockReturnValue(false);
      certificate = {
        id: 'cert-1',
        verificationCode: 'AB12CD34',
        issuerStellarAddress: 'GISSUER',
        recipientStellarAddress: 'GRECIPIENT',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        stellarTransactionHash: undefined,
      } as unknown as Certificate;
    });

    it('returns the existing hash without touching the chain when already synced', async () => {
      const synced = {
        ...certificate,
        stellarTransactionHash: 'abc123',
      } as unknown as Certificate;
      jest.spyOn(service, 'findOne').mockResolvedValue(synced);

      const result = await service.syncChain('cert-1');

      expect(result.alreadySynced).toBe(true);
      expect(result.stellarTransactionHash).toBe('abc123');
      expect(sorobanService.issueCertificate).not.toHaveBeenCalled();
      expect(certificateRepository.update).not.toHaveBeenCalled();
    });

    it('refuses to retry when Soroban is not configured', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(certificate);

      await expect(service.syncChain('cert-1')).rejects.toThrow(
        /not configured/i,
      );
      expect(certificateRepository.update).not.toHaveBeenCalled();
    });

    it('persists the transaction hash returned by a successful retry', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(certificate);
      sorobanService.isConfigured.mockReturnValue(true);
      sorobanService.issueCertificate.mockResolvedValue('deadbeef');
      certificateRepository.update.mockResolvedValue({ affected: 1 });

      const result = await service.syncChain('cert-1');

      expect(sorobanService.issueCertificate).toHaveBeenCalledWith(
        'cert-1',
        'GISSUER',
        'GRECIPIENT',
        'AB12CD34',
        Math.floor(new Date('2027-01-01T00:00:00.000Z').getTime() / 1000),
      );
      expect(certificateRepository.update).toHaveBeenCalledWith('cert-1', {
        stellarTransactionHash: 'deadbeef',
      });
      expect(result.alreadySynced).toBe(false);
      expect(result.stellarTransactionHash).toBe('deadbeef');
    });

    it('fails loudly when the retry still cannot reach the chain', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(certificate);
      sorobanService.isConfigured.mockReturnValue(true);
      sorobanService.issueCertificate.mockResolvedValue(null);

      await expect(service.syncChain('cert-1')).rejects.toThrow(
        /on-chain issuance failed/i,
      );
      expect(certificateRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('certificate ownership enforcement (#1008)', () => {
    const OWNER = 'issuer-owner';
    const OTHER_ISSUER = 'issuer-other';
    const ADMIN = 'admin-user';

    const buildCertificate = (overrides: Partial<Certificate> = {}) =>
      ({
        id: 'cert-1008',
        issuerId: OWNER,
        status: CertificateStatus.ACTIVE,
        metadata: {},
        ...overrides,
      }) as unknown as Certificate;

    beforeEach(() => {
      jest.clearAllMocks();
      certificateRepository.save.mockImplementation(async (cert: any) => cert);
      webhooksService.triggerEvent.mockResolvedValue(undefined);
    });

    it('rejects an update from a different issuer', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(buildCertificate());

      await expect(
        service.updateWithUser(
          'cert-1008',
          {} as any,
          OTHER_ISSUER,
          UserRole.ISSUER,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(certificateRepository.save).not.toHaveBeenCalled();
    });

    it('allows the owning issuer to update their certificate', async () => {
      const certificate = buildCertificate();
      jest.spyOn(service, 'findOne').mockResolvedValue(certificate);

      await service.updateWithUser(
        'cert-1008',
        { title: 'Updated title' } as any,
        OWNER,
        UserRole.ISSUER,
      );

      expect(certificateRepository.save).toHaveBeenCalledWith(certificate);
    });

    it('rejects a revoke from a different issuer', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(buildCertificate());

      await expect(
        service.revokeWithUser(
          'cert-1008',
          { reason: 'not the owner' } as any,
          OTHER_ISSUER,
          '127.0.0.1',
          'jest',
          UserRole.ISSUER,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(certificateRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a freeze from a different issuer', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(buildCertificate());

      await expect(
        service.freeze(
          'cert-1008',
          'compliance hold',
          undefined,
          OTHER_ISSUER,
          UserRole.ISSUER,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(certificateRepository.save).not.toHaveBeenCalled();
    });

    it('rejects an unfreeze from a different issuer', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValue(
          buildCertificate({ status: CertificateStatus.FROZEN }),
        );

      await expect(
        service.unfreeze('cert-1008', 'release', OTHER_ISSUER, UserRole.ISSUER),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(certificateRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a caller without an issuer identity', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(buildCertificate());

      await expect(
        service.freeze('cert-1008', 'hold', undefined, undefined, undefined),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(certificateRepository.save).not.toHaveBeenCalled();
    });

    it('lets the owning issuer freeze and emits CERTIFICATE_FROZEN', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(buildCertificate());

      const saved = await service.freeze(
        'cert-1008',
        'compliance hold',
        undefined,
        OWNER,
        UserRole.ISSUER,
      );

      expect(saved.status).toBe(CertificateStatus.FROZEN);
      expect(webhooksService.triggerEvent).toHaveBeenCalledWith(
        WebhookEvent.CERTIFICATE_FROZEN,
        OWNER,
        expect.objectContaining({ id: 'cert-1008' }),
      );
    });

    it('lets an admin freeze another issuer certificate', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(buildCertificate());

      const saved = await service.freeze(
        'cert-1008',
        'admin hold',
        7,
        ADMIN,
        UserRole.ADMIN,
      );

      expect(saved.status).toBe(CertificateStatus.FROZEN);
      expect(saved.metadata?.freezeDurationDays).toBe(7);
    });

    it('lets the owning issuer unfreeze and emits CERTIFICATE_UNFROZEN', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValue(
          buildCertificate({ status: CertificateStatus.FROZEN }),
        );

      const saved = await service.unfreeze(
        'cert-1008',
        'issue resolved',
        OWNER,
        UserRole.ISSUER,
      );

      expect(saved.status).toBe(CertificateStatus.ACTIVE);
      expect(webhooksService.triggerEvent).toHaveBeenCalledWith(
        WebhookEvent.CERTIFICATE_UNFROZEN,
        OWNER,
        expect.objectContaining({ id: 'cert-1008' }),
      );
    });
  });
});
