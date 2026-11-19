import { Test, TestingModule } from '@nestjs/testing';
import { Certificate } from '../entities/certificate.entity';
import { CertificateTemplate } from '../entities/certificate-template.entity';
import { CertificatePdfService } from './pdf.service';
import { QrCodeService } from '../../files/services/qrcode.service';
import { LoggingService } from '../../../common/logging/logging.service';

/** Minimal valid 1×1 transparent PNG. */
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const makeCertificate = (overrides: Partial<Certificate> = {}): Certificate =>
  ({
    id: 'cert-uuid-1',
    certificateId: 'CERT-2026-AB12CD34',
    recipientName: 'Ada Lovelace',
    title: 'Advanced Computing',
    courseName: 'Analytical Engines',
    issuerName: 'Stellar Academy',
    issuedAt: new Date('2026-01-15T00:00:00Z'),
    expiresAt: undefined,
    verificationCode: 'AB12CD34',
    templateId: undefined,
    ...overrides,
  }) as Certificate;

const makeTemplate = (
  overrides: Partial<CertificateTemplate> = {},
): CertificateTemplate =>
  ({
    id: 'tpl-uuid-1',
    name: 'Acme Gold',
    description: null,
    issuerId: 'issuer-1',
    isActive: true,
    isDefault: true,
    titleText: 'Certificate of Mastery',
    primaryColor: '#123456',
    accentColor: '#abcdef',
    logoImage: TINY_PNG_DATA_URL,
    signatureImage: TINY_PNG_DATA_URL,
    orientation: 'landscape',
    layout: undefined,
    ...overrides,
  }) as CertificateTemplate;

describe('CertificatePdfService', () => {
  let service: CertificatePdfService;
  const qrCodeService = {
    generateQrCode: jest.fn(),
  };
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // pdfkit decodes the buffer, so the mock must return a real PNG.
    qrCodeService.generateQrCode.mockResolvedValue(
      Buffer.from(TINY_PNG_DATA_URL.split(',')[1], 'base64'),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificatePdfService,
        { provide: QrCodeService, useValue: qrCodeService },
        { provide: LoggingService, useValue: logger },
      ],
    }).compile();

    service = module.get<CertificatePdfService>(CertificatePdfService);
  });

  const expectValidPdf = (buffer: Buffer) => {
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(500);
  };

  describe('default layout (no template)', () => {
    it('produces a valid PDF and embeds the verification QR code', async () => {
      const buffer = await service.generate(makeCertificate());

      expectValidPdf(buffer);
      expect(qrCodeService.generateQrCode).toHaveBeenCalledWith(
        'http://localhost:5173/verify?serial=AB12CD34',
      );
      // The QR PNG arrives as an image XObject; its dictionary is not
      // compressed, so the marker is visible in the raw bytes.
      expect(buffer.toString('latin1')).toMatch(/\/Subtype\s*\/Image/);
      // Backward compatibility: the template-less layout stays portrait.
      expect(buffer.toString('latin1')).toContain('595.28 841.89');
    });

    it('honours FRONTEND_URL when building the verification URL', async () => {
      const original = process.env.FRONTEND_URL;
      process.env.FRONTEND_URL = 'https://stellarcert.app';
      try {
        await service.generate(makeCertificate());
        expect(qrCodeService.generateQrCode).toHaveBeenCalledWith(
          'https://stellarcert.app/verify?serial=AB12CD34',
        );
      } finally {
        if (original === undefined) delete process.env.FRONTEND_URL;
        else process.env.FRONTEND_URL = original;
      }
    });

    it('omits the QR when the certificate has no verification code', async () => {
      const buffer = await service.generate(
        makeCertificate({ verificationCode: undefined }),
      );

      expectValidPdf(buffer);
      expect(qrCodeService.generateQrCode).not.toHaveBeenCalled();
      expect(buffer.toString('latin1')).not.toMatch(/\/Subtype\s*\/Image/);
    });

    it('still produces the PDF when QR generation fails', async () => {
      qrCodeService.generateQrCode.mockRejectedValue(new Error('qr down'));

      const buffer = await service.generate(makeCertificate());

      expectValidPdf(buffer);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('template-driven layout', () => {
    it('renders a landscape PDF with logo, signature and QR embedded', async () => {
      const buffer = await service.generate(makeCertificate(), makeTemplate());

      expectValidPdf(buffer);
      const raw = buffer.toString('latin1');
      // Logo + signature + QR; PNG alpha channels add smask XObjects,
      // so only the lower bound is asserted.
      const imageMarkers = raw.match(/\/Subtype\s*\/Image/g) ?? [];
      expect(imageMarkers.length).toBeGreaterThanOrEqual(3);
      // A4 landscape media box
      expect(raw).toContain('841.89 595.28');
    });

    it('renders portrait templates on a portrait page', async () => {
      const buffer = await service.generate(
        makeCertificate(),
        makeTemplate({ orientation: 'portrait' }),
      );

      expectValidPdf(buffer);
      expect(buffer.toString('latin1')).toContain('595.28 841.89');
    });

    it('applies custom field placement without errors', async () => {
      const buffer = await service.generate(
        makeCertificate(),
        makeTemplate({
          layout: {
            fields: {
              recipientName: { x: 100, y: 250, fontSize: 36, align: 'center' },
              title: { x: 50, y: 60, fontSize: 28, align: 'left' },
            },
            qrCode: { x: 700, y: 450, width: 80 },
          },
        }),
      );

      expectValidPdf(buffer);
      expect(qrCodeService.generateQrCode).toHaveBeenCalledWith(
        'http://localhost:5173/verify?serial=AB12CD34',
      );
    });

    it('falls back to default colours when the template has invalid ones', async () => {
      const buffer = await service.generate(
        makeCertificate(),
        makeTemplate({ primaryColor: 'javascript:alert(1)', accentColor: '' }),
      );

      expectValidPdf(buffer);
    });

    it('skips corrupt base64 images instead of failing the download', async () => {
      const buffer = await service.generate(
        makeCertificate(),
        makeTemplate({
          logoImage: 'data:image/png;base64,%%%not-base64%%%',
          signatureImage: undefined,
        }),
      );

      expectValidPdf(buffer);
      // QR is still embedded despite the broken logo.
      expect(buffer.toString('latin1')).toMatch(/\/Subtype\s*\/Image/);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('uses the template title text', async () => {
      const buffer = await service.generate(
        makeCertificate(),
        makeTemplate({ titleText: 'Award of Excellence' }),
      );

      expectValidPdf(buffer);
    });

    it('still embeds the QR when the template has no logo or signature', async () => {
      const buffer = await service.generate(
        makeCertificate(),
        makeTemplate({ logoImage: undefined, signatureImage: undefined }),
      );

      expectValidPdf(buffer);
      // QR only; the transparent PNG may also add a smask XObject.
      const imageMarkers =
        buffer.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? [];
      expect(imageMarkers.length).toBeGreaterThanOrEqual(1);
    });
  });
});
