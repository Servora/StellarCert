import { BulkCertificateService } from './services/bulk-certificate.service';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CertificateController } from './certificate.controller';
import { CertificateService } from './certificate.service';
import { CertificateStatsService } from './services/stats.service';
import { CertificatePdfService } from './services/pdf.service';
import { CertificateTemplateService } from './services/template.service';
import { CertificateMapper } from './mappers/certificate.mapper';
import { UserRole } from '../../common/constants/roles';

describe('CertificateController', () => {
  let controller: CertificateController;
  const certificateService = {
    findOne: jest.fn(),
    getCertificateQrCode: jest.fn(),
    verifyCertificate: jest.fn(),
    verifyByCode: jest.fn(),
    findAll: jest.fn(),
    exportCertificates: jest.fn(),
    bulkExport: jest.fn(),
    exportAllFiltered: jest.fn(),
    updateWithUser: jest.fn(),
    revokeWithUser: jest.fn(),
    freeze: jest.fn(),
    unfreeze: jest.fn(),
    findForRecipient: jest.fn(),
  };
  const statsService = {
    getPublicSummary: jest.fn(),
    getStatistics: jest.fn(),
  };
  const certificateMapper = {
    toResponse: jest.fn(),
    toVerificationResult: jest.fn(),
  };
  const templateService = {
    findByIdForRendering: jest.fn(),
  };
  const pdfService = {
    generate: jest.fn(),
  };
  const bulkCertificateService = {
    processCsvBulk: jest.fn(),
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
          provide: CertificateTemplateService,
          useValue: templateService,
        },
        {
          provide: BulkCertificateService,
          useValue: bulkCertificateService,
        },
        {
          provide: CertificateMapper,
          useValue: certificateMapper,
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
            verify: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: Reflector,
          useValue: new Reflector(),
        },
      ],
    }).compile();

    controller = module.get<CertificateController>(CertificateController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('statistics scoping (#1106)', () => {
    beforeEach(() => {
      statsService.getStatistics.mockReset();
      statsService.getStatistics.mockResolvedValue({
        verificationStats: { dailyVerifications: 7 },
      });
    });

    it("forces an ISSUER's stats to their own issuer id, ignoring a passed issuerId", async () => {
      const result = await controller.getStatistics(
        { issuerId: 'someone-elses-issuer-id' },
        'issuer-own-id',
        UserRole.ISSUER,
      );

      expect(statsService.getStatistics).toHaveBeenCalledWith({
        issuerId: 'issuer-own-id',
      });
      expect(result).toEqual({
        verificationStats: { dailyVerifications: 7 },
      });
    });

    it('lets an ADMIN query any issuer (cross-issuer stats)', async () => {
      await controller.getStatistics(
        { issuerId: 'other-issuer-id' },
        'admin-id',
        UserRole.ADMIN,
      );

      expect(statsService.getStatistics).toHaveBeenCalledWith({
        issuerId: 'other-issuer-id',
      });
    });

    it('lets an AUDITOR query platform-wide stats', async () => {
      await controller.getStatistics({}, 'auditor-id', UserRole.AUDITOR);

      expect(statsService.getStatistics).toHaveBeenCalledWith({});
    });

    it('scopes daily-verification for an ISSUER but not for an ADMIN', async () => {
      await controller.getDailyVerification('issuer-own-id', UserRole.ISSUER);
      expect(statsService.getStatistics).toHaveBeenLastCalledWith({
        issuerId: 'issuer-own-id',
      });

      await controller.getDailyVerification('admin-id', UserRole.ADMIN);
      expect(statsService.getStatistics).toHaveBeenLastCalledWith({});
    });

    it('rejects an ISSUER token without a subject instead of falling back to global stats', async () => {
      await expect(
        controller.getStatistics({}, undefined, UserRole.ISSUER),
      ).rejects.toThrow(ForbiddenException);

      expect(statsService.getStatistics).not.toHaveBeenCalled();
    });
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

    const expectedResponse = {
      id: mockCertificate.id,
      title: mockCertificate.title,
      recipientName: mockCertificate.recipientName,
      recipientEmail: mockCertificate.recipientEmail,
      status: mockCertificate.status,
      issuedAt: mockCertificate.issuedAt,
      expiresAt: mockCertificate.expiresAt,
      issuer: mockCertificate.issuer,
      verificationCode: mockCertificate.verificationCode,
    };

    certificateService.verifyByCode.mockResolvedValue(mockCertificate);
    certificateMapper.toVerificationResult.mockReturnValue(expectedResponse);

    const req = {
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      headers: {},
    };
    await expect(
      (controller as any).verifyByCode('AB12CD34', req, 'public'),
    ).resolves.toEqual(expectedResponse);
    expect(certificateService.verifyByCode).toHaveBeenCalledWith(
      'AB12CD34',
      'public',
      '127.0.0.1',
      'unknown',
    );
  });

  describe('findAll scoping and limit capping', () => {
    beforeEach(() => {
      certificateService.findAll.mockResolvedValue({
        certificates: [],
        total: 0,
      });
      certificateMapper.toResponse.mockReturnValue({});
    });

    it('should force non-admin issuer to their own issuerId even if another issuerId is requested', async () => {
      await controller.findAll(
        1,
        10,
        'other-issuer-id',
        undefined,
        'my-issuer-id',
        UserRole.ISSUER,
      );

      expect(certificateService.findAll).toHaveBeenCalledWith(
        1,
        10,
        'my-issuer-id',
        undefined,
      );
    });

    it('should force non-admin issuer to their own issuerId when no issuerId is requested', async () => {
      await controller.findAll(
        1,
        10,
        undefined,
        undefined,
        'my-issuer-id',
        UserRole.ISSUER,
      );

      expect(certificateService.findAll).toHaveBeenCalledWith(
        1,
        10,
        'my-issuer-id',
        undefined,
      );
    });

    it('should allow admin to query certificates of any issuer', async () => {
      await controller.findAll(
        1,
        10,
        'other-issuer-id',
        undefined,
        'admin-id',
        UserRole.ADMIN,
      );

      expect(certificateService.findAll).toHaveBeenCalledWith(
        1,
        10,
        'other-issuer-id',
        undefined,
      );
    });

    it('should allow admin to query certificates across all issuers without issuerId filter', async () => {
      await controller.findAll(
        1,
        10,
        undefined,
        undefined,
        'admin-id',
        UserRole.ADMIN,
      );

      expect(certificateService.findAll).toHaveBeenCalledWith(
        1,
        10,
        undefined,
        undefined,
      );
    });

    it('should cap limit at 100 when a higher limit is requested', async () => {
      await controller.findAll(
        1,
        500,
        undefined,
        undefined,
        'admin-id',
        UserRole.ADMIN,
      );

      expect(certificateService.findAll).toHaveBeenCalledWith(
        1,
        100,
        undefined,
        undefined,
      );
    });
  });

  describe('exportCertificates scoping and limit capping', () => {
    beforeEach(() => {
      certificateService.exportCertificates.mockResolvedValue([]);
    });

    it('should force non-admin issuer to their own issuerId', async () => {
      await controller.exportCertificates(
        'other-issuer-id',
        'active',
        undefined,
        'my-issuer-id',
        UserRole.ISSUER,
      );

      expect(certificateService.exportCertificates).toHaveBeenCalledWith(
        'my-issuer-id',
        'active',
        1000,
        'my-issuer-id',
        UserRole.ISSUER,
      );
    });

    it('should allow admin to export any issuer certificates', async () => {
      await controller.exportCertificates(
        'other-issuer-id',
        'active',
        undefined,
        'admin-id',
        UserRole.ADMIN,
      );

      expect(certificateService.exportCertificates).toHaveBeenCalledWith(
        'other-issuer-id',
        'active',
        1000,
        'admin-id',
        UserRole.ADMIN,
      );
    });

    it('should cap export limit at 1000', async () => {
      await controller.exportCertificates(
        undefined,
        undefined,
        5000,
        'admin-id',
        UserRole.ADMIN,
      );

      expect(certificateService.exportCertificates).toHaveBeenCalledWith(
        undefined,
        undefined,
        1000,
        'admin-id',
        UserRole.ADMIN,
      );
    });
  });

  describe('bulkExport scoping', () => {
    const mockRes = () => ({
      setHeader: jest.fn(),
      send: jest.fn(),
    });

    beforeEach(() => {
      certificateService.bulkExport.mockResolvedValue('id,title\n1,Cert');
    });

    it('should force non-admin issuer to their own issuerId', async () => {
      const res = mockRes();
      await controller.bulkExport(
        {
          certificateIds: ['a3d8a582-bd23-4a2d-9630-6d4a2f5fd6f0'],
          filters: { issuerId: 'other-issuer-id' },
        },
        res,
        'my-issuer-id',
        UserRole.ISSUER,
      );

      expect(certificateService.bulkExport).toHaveBeenCalledWith(
        ['a3d8a582-bd23-4a2d-9630-6d4a2f5fd6f0'],
        { issuerId: 'other-issuer-id' },
        'my-issuer-id',
        UserRole.ISSUER,
      );
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(res.send).toHaveBeenCalledWith('id,title\n1,Cert');
    });

    it('should allow admin to filter by specified issuerId in bulk export', async () => {
      const res = mockRes();
      await controller.bulkExport(
        {
          certificateIds: [],
          filters: { issuerId: 'targeted-issuer-id' },
        },
        res,
        'admin-id',
        UserRole.ADMIN,
      );

      expect(certificateService.bulkExport).toHaveBeenCalledWith(
        [],
        { issuerId: 'targeted-issuer-id' },
        'targeted-issuer-id',
        UserRole.ADMIN,
      );
    });
  });

  describe('exportAllFiltered scoping', () => {
    const mockRes = () => ({
      setHeader: jest.fn(),
      send: jest.fn(),
    });

    beforeEach(() => {
      certificateService.exportAllFiltered.mockResolvedValue(
        'id,title\n1,Cert',
      );
    });

    it('should force non-admin issuer to their own issuerId', async () => {
      const res = mockRes();
      await controller.exportAllFiltered(
        { issuerId: 'other-issuer-id', status: 'active' },
        res,
        'my-issuer-id',
        UserRole.ISSUER,
      );

      expect(certificateService.exportAllFiltered).toHaveBeenCalledWith(
        { issuerId: 'other-issuer-id', status: 'active' },
        'my-issuer-id',
        UserRole.ISSUER,
      );
    });

    it('should allow admin to filter by target issuerId or export all', async () => {
      const res = mockRes();
      await controller.exportAllFiltered(
        { issuerId: 'target-issuer-id' },
        res,
        'admin-id',
        UserRole.ADMIN,
      );

      expect(certificateService.exportAllFiltered).toHaveBeenCalledWith(
        { issuerId: 'target-issuer-id' },
        'target-issuer-id',
        UserRole.ADMIN,
      );
    });
  });

  describe('mutation ownership plumbing (#1008)', () => {
    const CERT_ID = 'a3d8a582-bd23-4a2d-9630-6d4a2f5fd6f0';
    const user = {
      id: 'issuer-owner',
      email: 'owner@example.com',
      role: UserRole.ISSUER,
    };

    beforeEach(() => {
      certificateService.updateWithUser.mockResolvedValue({});
      certificateService.revokeWithUser.mockResolvedValue({});
      certificateService.freeze.mockResolvedValue({});
      certificateService.unfreeze.mockResolvedValue({});
    });

    it('forwards the issuer identity and role when updating', async () => {
      await controller.update(CERT_ID, { title: 'New' }, user);

      expect(certificateService.updateWithUser).toHaveBeenCalledWith(
        CERT_ID,
        { title: 'New' },
        user.id,
        user.role,
      );
    });

    it('forwards the issuer identity and role when revoking', async () => {
      const req = {
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
        headers: {},
      };

      await controller.revoke(
        CERT_ID,
        { reason: 'policy violation' },
        user,
        req as any,
      );

      expect(certificateService.revokeWithUser).toHaveBeenCalledWith(
        CERT_ID,
        { reason: 'policy violation' },
        user.id,
        '127.0.0.1',
        'unknown',
        user.role,
      );
    });

    it('forwards the freeze DTO and issuer identity to the service', async () => {
      await controller.freeze(
        CERT_ID,
        { reason: 'compliance hold', durationDays: 3 },
        user,
      );

      expect(certificateService.freeze).toHaveBeenCalledWith(
        CERT_ID,
        'compliance hold',
        3,
        user.id,
        user.role,
      );
    });

    it('forwards the unfreeze DTO and issuer identity to the service', async () => {
      await controller.unfreeze(CERT_ID, { reason: 'issue resolved' }, user);

      expect(certificateService.unfreeze).toHaveBeenCalledWith(
        CERT_ID,
        'issue resolved',
        user.id,
        user.role,
      );
    });
  });

  describe('getMyCertificates', () => {
    it('delegates to findForRecipient with the caller id and paging', async () => {
      const mockCerts = [{ id: 'cert-1', recipientEmail: 'alice@example.com' }];
      certificateService.findForRecipient.mockResolvedValueOnce(mockCerts);

      const user = {
        id: 'user-123',
        email: 'alice@example.com',
        role: UserRole.RECIPIENT,
      };

      const result = await controller.getMyCertificates(user, 2, 5);

      // Whether the email may be matched is decided in the service, from the
      // database, never from anything the caller can influence.
      expect(certificateService.findForRecipient).toHaveBeenCalledWith(
        'user-123',
        2,
        5,
      );
      expect(result).toEqual(mockCerts);
    });
  });

  describe('getCertificatePdf template resolution (#1180)', () => {
    const CERT_ID = 'a3d8a582-bd23-4a2d-9630-6d4a2f5fd6f0';

    beforeEach(() => {
      certificateService.findOne.mockResolvedValue({
        id: CERT_ID,
        certificateId: 'CERT-2026-TEST01',
        templateId: 'tpl-1',
        verificationCode: 'AB12CD34',
      });
      pdfService.generate.mockResolvedValue(Buffer.from('%PDF-1.4'));
      templateService.findByIdForRendering.mockReset();
    });

    it('renders with the stored template when templateId resolves', async () => {
      const template = { id: 'tpl-1', primaryColor: '#123456' };
      templateService.findByIdForRendering.mockResolvedValue(template);

      const res = { setHeader: jest.fn(), end: jest.fn() };
      await controller.getCertificatePdf(CERT_ID, res as any);

      expect(templateService.findByIdForRendering).toHaveBeenCalledWith(
        'tpl-1',
      );
      expect(pdfService.generate).toHaveBeenCalledWith(
        expect.objectContaining({ id: CERT_ID }),
        template,
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/pdf',
      );
      expect(res.end).toHaveBeenCalled();
    });

    it('falls back to the default layout when the template is unknown or deactivated', async () => {
      templateService.findByIdForRendering.mockResolvedValue(null);

      const res = { setHeader: jest.fn(), end: jest.fn() };
      await controller.getCertificatePdf(CERT_ID, res as any);

      expect(pdfService.generate).toHaveBeenCalledWith(
        expect.objectContaining({ id: CERT_ID }),
        null,
      );
      expect(res.end).toHaveBeenCalled();
    });

    it('still queries rendering when the certificate has no templateId', async () => {
      certificateService.findOne.mockResolvedValue({
        id: CERT_ID,
        certificateId: 'CERT-2026-TEST02',
        templateId: undefined,
        verificationCode: 'CD56EF78',
      });
      templateService.findByIdForRendering.mockResolvedValue(null);

      const res = { setHeader: jest.fn(), end: jest.fn() };
      await controller.getCertificatePdf(CERT_ID, res as any);

      expect(templateService.findByIdForRendering).toHaveBeenCalledWith(
        undefined,
      );
      expect(pdfService.generate).toHaveBeenCalledWith(expect.anything(), null);
    });
  });

  describe('bulkIssue', () => {
    it('throws BadRequestException when no file is uploaded', async () => {
      await expect(
        controller.bulkIssue(null as any, {}, { id: 'issuer-1', email: 'issuer@test.com', role: UserRole.ISSUER }),
      ).rejects.toThrow();
    });

    it('delegates to bulkCertificateService.processCsvBulk with file buffer, dto and user id', async () => {
      const mockResult = {
        totalRows: 1,
        validRows: 1,
        invalidRows: 0,
        duplicateHits: 0,
        blockedRows: 0,
        warningRows: 0,
        rows: [],
        canQueue: true,
        jobId: 'job-123',
      };
      bulkCertificateService.processCsvBulk.mockResolvedValue(mockResult);

      const file = { buffer: Buffer.from('recipientEmail,recipientName,title\na@b.com,Alice,Cert') };
      const dto = { metadataSchemaId: 'schema-1' };
      const user = { id: 'issuer-123', email: 'issuer@test.com', role: UserRole.ISSUER };

      const result = await controller.bulkIssue(file, dto, user);

      expect(bulkCertificateService.processCsvBulk).toHaveBeenCalledWith(
        file.buffer,
        dto,
        'issuer-123',
      );
      expect(result).toBe(mockResult);
    });
  });
});
