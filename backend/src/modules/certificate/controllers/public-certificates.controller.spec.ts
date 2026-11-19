import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PublicCertificatesController } from './public-certificates.controller';
import { CertificateService } from '../certificate.service';
import { CertificateMapper } from '../mappers/certificate.mapper';
import type { PublicCertificateDto } from '../mappers/certificate.mapper';

describe('PublicCertificatesController (#1178)', () => {
  let controller: PublicCertificatesController;
  const certificateService = {
    findByPublicId: jest.fn(),
  };
  const mapper = {
    toPublicProjection: jest.fn(),
  };
  const configService = {
    get: jest.fn(),
  };

  const projection: PublicCertificateDto = {
    publicId: 'CERT-2026-AB12CD34',
    title: 'Diploma',
    recipientName: 'Jane Doe',
    issuerName: 'Acme Academy',
    status: 'valid',
    issuedAt: new Date('2026-01-01'),
    verificationCount: 3,
    chainProof: {
      anchored: true,
      transactionHash: 'abc123',
      explorerUrl: 'https://stellar.expert/explorer/public/tx/abc123',
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicCertificatesController],
      providers: [
        { provide: CertificateService, useValue: certificateService },
        { provide: CertificateMapper, useValue: mapper },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get(PublicCertificatesController);
  });

  describe('getPublicCertificate', () => {
    it('looks up by the public serial and returns the mapped projection', async () => {
      const certificate = { id: 'cert-1' };
      certificateService.findByPublicId.mockResolvedValue(certificate);
      mapper.toPublicProjection.mockReturnValue(projection);
      configService.get.mockReturnValue(undefined);

      const result =
        await controller.getPublicCertificate('CERT-2026-AB12CD34');

      expect(certificateService.findByPublicId).toHaveBeenCalledWith(
        'CERT-2026-AB12CD34',
      );
      expect(mapper.toPublicProjection).toHaveBeenCalledWith(
        certificate,
        'public',
      );
      expect(result).toBe(projection);
    });

    it('uses the testnet network when configured', async () => {
      certificateService.findByPublicId.mockResolvedValue({});
      mapper.toPublicProjection.mockReturnValue(projection);
      configService.get.mockReturnValue('testnet');

      await controller.getPublicCertificate('CERT-2026-AB12CD34');

      expect(mapper.toPublicProjection).toHaveBeenCalledWith(
        expect.anything(),
        'testnet',
      );
    });
  });

  describe('getBadge', () => {
    const makeRes = () => ({
      setHeader: jest.fn(),
      send: jest.fn(),
    });

    it('serves a CORS-friendly, CSP-locked SVG badge', async () => {
      certificateService.findByPublicId.mockResolvedValue({});
      mapper.toPublicProjection.mockReturnValue(projection);
      const res = makeRes();

      await controller.getBadge('CERT-2026-AB12CD34', res as any);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Cross-Origin-Resource-Policy',
        'cross-origin',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'image/svg+xml; charset=utf-8',
      );
      const [body] = res.send.mock.calls[0];
      expect(body).toContain('<svg');
      expect(body).toContain('VALID');
      expect(body).toContain(projection.title);
    });

    it('escapes XML-significant characters from certificate data', async () => {
      certificateService.findByPublicId.mockResolvedValue({});
      mapper.toPublicProjection.mockReturnValue({
        ...projection,
        title: '<script>alert(1)</script> & "quoted"',
      });
      const res = makeRes();

      await controller.getBadge('CERT-2026-AB12CD34', res as any);

      const [body] = res.send.mock.calls[0];
      expect(body).not.toContain('<script>');
      expect(body).toContain('&lt;script&gt;');
      expect(body).toContain('&amp;');
    });
  });

  describe('getEmbedPage', () => {
    it('removes the global frame-deny header and serves an iframe-ready page', async () => {
      certificateService.findByPublicId.mockResolvedValue({});
      mapper.toPublicProjection.mockReturnValue(projection);
      const res = {
        removeHeader: jest.fn(),
        setHeader: jest.fn(),
        send: jest.fn(),
      };

      await controller.getEmbedPage('CERT-2026-AB12CD34', res as any);

      expect(res.removeHeader).toHaveBeenCalledWith('X-Frame-Options');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Security-Policy',
        expect.stringContaining('frame-ancestors *'),
      );
      const [body] = res.send.mock.calls[0];
      expect(body).toContain('<html');
      expect(body).toContain('./badge');
    });
  });
});
