import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Certificate } from '../entities/certificate.entity';
import {
  CertificateTemplate,
  TemplateFieldName,
  TemplateFieldPlacement,
} from '../entities/certificate-template.entity';
import { QrCodeService } from '../../files/services/qrcode.service';
import { LoggingService } from '../../../common/logging/logging.service';
import { buildVerificationUrl } from '../../../config/public-url.config';

const DEFAULT_PRIMARY_COLOR = '#1a365d';
const DEFAULT_ACCENT_COLOR = '#b08d2e';
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

const FONT_REGULAR = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';

interface ResolvedField extends TemplateFieldPlacement {
  width: number;
}

@Injectable()
export class CertificatePdfService {
  constructor(
    private readonly qrCodeService: QrCodeService,
    private readonly logger: LoggingService,
  ) {}

  async generate(
    certificate: Certificate,
    template?: CertificateTemplate | null,
  ): Promise<Buffer> {
    const verificationUrl = certificate.verificationCode
      ? buildVerificationUrl(certificate.verificationCode)
      : undefined;

    let qrCodeBuffer: Buffer | undefined;
    if (verificationUrl) {
      try {
        qrCodeBuffer = await this.qrCodeService.generateQrCode(verificationUrl);
      } catch (error) {
        // A missing QR must not fail the PDF download.
        this.logger.warn(
          `Failed to generate QR code for certificate ${certificate.certificateId}: ${error.message}`,
        );
      }
    }

    // The pre-template default layout is portrait; only an explicit
    // template orientation switches the page.
    const isLandscape = template ? template.orientation !== 'portrait' : false;

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        layout: isLandscape ? 'landscape' : 'portrait',
        margin: 40,
      });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      try {
        if (template) {
          this.renderFromTemplate(doc, certificate, template, qrCodeBuffer);
        } else {
          this.renderDefault(doc, certificate, qrCodeBuffer);
        }
      } catch (error) {
        reject(error);
        return;
      }

      doc.end();
    });
  }

  /** Backward-compatible fixed layout, now with the verification QR embedded. */
  private renderDefault(
    doc: PDFKit.PDFDocument,
    certificate: Certificate,
    qrCodeBuffer?: Buffer,
  ): void {
    doc
      .fontSize(26)
      .font(FONT_BOLD)
      .fillColor(DEFAULT_PRIMARY_COLOR)
      .text('Certificate of Achievement', { align: 'center' });
    doc.moveDown();
    doc
      .fontSize(13)
      .font(FONT_REGULAR)
      .fillColor('black')
      .text('This certifies that', { align: 'center' });
    doc.moveDown(0.5);
    doc
      .fontSize(20)
      .font(FONT_BOLD)
      .fillColor(DEFAULT_ACCENT_COLOR)
      .text(certificate.recipientName, { align: 'center' });
    doc.moveDown();
    doc
      .fontSize(13)
      .font(FONT_REGULAR)
      .fillColor('black')
      .text(certificate.title, { align: 'center' });

    if (certificate.courseName) {
      doc.fontSize(12).text(`Course: ${certificate.courseName}`, {
        align: 'center',
      });
    }

    doc.moveDown();
    doc.fontSize(11).text(`Certificate ID: ${certificate.certificateId}`, {
      align: 'center',
    });
    doc.fontSize(11).text(`Issued by: ${certificate.issuerName ?? 'Unknown'}`, {
      align: 'center',
    });
    doc
      .fontSize(11)
      .text(
        `Issued on: ${new Date(certificate.issuedAt).toLocaleDateString()}`,
        { align: 'center' },
      );

    if (certificate.expiresAt) {
      doc
        .fontSize(11)
        .text(
          `Expires: ${new Date(certificate.expiresAt).toLocaleDateString()}`,
          { align: 'center' },
        );
    }

    this.embedQrCode(doc, qrCodeBuffer, {
      x: (doc.page.width - 90) / 2,
      y: doc.page.height - 130,
      width: 90,
    });
  }

  private renderFromTemplate(
    doc: PDFKit.PDFDocument,
    certificate: Certificate,
    template: CertificateTemplate,
    qrCodeBuffer?: Buffer,
  ): void {
    const width = doc.page.width;
    const height = doc.page.height;
    const primary = this.color(template.primaryColor, DEFAULT_PRIMARY_COLOR);
    const accent = this.color(template.accentColor, DEFAULT_ACCENT_COLOR);
    const fields = template.layout?.fields ?? {};

    const resolve = (
      name: TemplateFieldName,
      defaults: Omit<ResolvedField, keyof TemplateFieldPlacement> &
        TemplateFieldPlacement,
    ): ResolvedField => ({ ...defaults, ...(fields[name] ?? {}) });

    // Borders
    doc
      .lineWidth(3)
      .strokeColor(primary)
      .rect(20, 20, width - 40, height - 40)
      .stroke();
    doc
      .lineWidth(1)
      .strokeColor(accent)
      .rect(30, 30, width - 60, height - 60)
      .stroke();

    // Logo
    const logo = template.layout?.logo ?? {
      x: (width - 90) / 2,
      y: 48,
      width: 90,
    };
    const hasLogo = this.embedImage(doc, template.logoImage, logo);

    // Title
    const title = resolve('title', {
      x: 50,
      y: hasLogo ? logo.y + logo.width + 24 : 70,
      fontSize: 34,
      align: 'center' as const,
      width: width - 100,
    });
    doc
      .fontSize(title.fontSize ?? 34)
      .font(FONT_BOLD)
      .fillColor(primary)
      .text(
        template.titleText || 'Certificate of Achievement',
        title.x,
        title.y,
        { width: title.width, align: title.align },
      );

    // Certify line
    const certify = resolve('certifyText', {
      x: 50,
      y: title.y + (title.fontSize ?? 34) + 28,
      fontSize: 16,
      align: 'center' as const,
      width: width - 100,
    });
    doc
      .fontSize(certify.fontSize ?? 16)
      .font(FONT_REGULAR)
      .fillColor('black')
      .text('This certifies that', certify.x, certify.y, {
        width: certify.width,
        align: certify.align,
      });

    // Recipient
    const recipient = resolve('recipientName', {
      x: 50,
      y: certify.y + (certify.fontSize ?? 16) + 26,
      fontSize: 30,
      align: 'center' as const,
      width: width - 100,
    });
    doc
      .fontSize(recipient.fontSize ?? 30)
      .font(FONT_BOLD)
      .fillColor(accent)
      .text(certificate.recipientName, recipient.x, recipient.y, {
        width: recipient.width,
        align: recipient.align,
      });

    // Course / completion line
    let courseY = recipient.y + (recipient.fontSize ?? 30) + 22;
    const courseName = certificate.courseName || certificate.title;
    if (courseName) {
      const completion = resolve('courseName', {
        x: 50,
        y: courseY,
        fontSize: 20,
        align: 'center' as const,
        width: width - 100,
      });
      doc
        .fontSize(completion.fontSize ?? 20)
        .font(FONT_BOLD)
        .fillColor(primary)
        .text(courseName, completion.x, completion.y, {
          width: completion.width,
          align: completion.align,
        });
      courseY = completion.y + (completion.fontSize ?? 20);
    }

    // Dates (bottom left) and certificate ID
    const issuedOn = `Issued on: ${new Date(certificate.issuedAt).toLocaleDateString()}`;
    const expiryLine = certificate.expiresAt
      ? `Expires: ${new Date(certificate.expiresAt).toLocaleDateString()}`
      : undefined;
    const issueDate = resolve('issueDate', {
      x: 60,
      y: height - (expiryLine ? 110 : 90),
      fontSize: 11,
      align: 'left' as const,
      width: 240,
    });
    doc
      .fontSize(issueDate.fontSize ?? 11)
      .font(FONT_REGULAR)
      .fillColor('black')
      .text(issuedOn, issueDate.x, issueDate.y, {
        width: issueDate.width,
        align: issueDate.align,
      });
    if (expiryLine) {
      doc.fontSize(11).text(expiryLine, issueDate.x, issueDate.y + 16, {
        width: issueDate.width,
        align: issueDate.align,
      });
    }
    const certificateId = resolve('certificateId', {
      x: 60,
      y: issueDate.y + (expiryLine ? 34 : 18),
      fontSize: 10,
      align: 'left' as const,
      width: 240,
    });
    doc
      .fontSize(certificateId.fontSize ?? 10)
      .font(FONT_REGULAR)
      .fillColor('#555555')
      .text(
        `Certificate ID: ${certificate.certificateId}`,
        certificateId.x,
        certificateId.y,
        {
          width: certificateId.width,
          align: certificateId.align,
        },
      );

    // Signature block (bottom right)
    const signature = template.layout?.signature ?? {
      x: width - 240,
      y: height - 170,
      width: 150,
    };
    this.embedImage(doc, template.signatureImage, signature);
    const issuerName = resolve('issuerName', {
      x: width - 260,
      y: signature.y + signature.width * 0.55 + 14,
      fontSize: 14,
      align: 'center' as const,
      width: 190,
    });
    doc
      .fontSize(issuerName.fontSize ?? 14)
      .font(FONT_BOLD)
      .fillColor('black')
      .text(certificate.issuerName ?? 'Unknown', issuerName.x, issuerName.y, {
        width: issuerName.width,
        align: issuerName.align,
      });
    const signatureLabel = resolve('signatureLabel', {
      x: width - 260,
      y: issuerName.y + (issuerName.fontSize ?? 14) + 6,
      fontSize: 10,
      align: 'center' as const,
      width: 190,
    });
    doc
      .fontSize(signatureLabel.fontSize ?? 10)
      .font(FONT_REGULAR)
      .fillColor('#555555')
      .text('Authorized Signature', signatureLabel.x, signatureLabel.y, {
        width: signatureLabel.width,
        align: signatureLabel.align,
      });

    // QR code with verification URL (bottom centre)
    const qr = template.layout?.qrCode ?? {
      x: (width - 90) / 2,
      y: height - 130,
      width: 90,
    };
    this.embedQrCode(doc, qrCodeBuffer, qr);
  }

  private embedQrCode(
    doc: PDFKit.PDFDocument,
    qrCodeBuffer: Buffer | undefined,
    placement: { x: number; y: number; width: number },
  ): void {
    if (!qrCodeBuffer) return;
    try {
      doc.image(qrCodeBuffer, placement.x, placement.y, {
        fit: [placement.width, placement.width],
      });
      doc
        .fontSize(9)
        .font(FONT_REGULAR)
        .fillColor('#555555')
        .text(
          'Scan to verify',
          placement.x,
          placement.y + placement.width + 4,
          {
            width: placement.width,
            align: 'center',
          },
        );
    } catch (error) {
      this.logger.warn(
        `Failed to embed QR code in certificate PDF: ${error.message}`,
      );
    }
  }

  private embedImage(
    doc: PDFKit.PDFDocument,
    dataUrl: string | undefined,
    placement: { x: number; y: number; width: number },
  ): boolean {
    if (!dataUrl) return false;
    try {
      const comma = dataUrl.indexOf(',');
      const buffer = Buffer.from(dataUrl.slice(comma + 1), 'base64');
      doc.image(buffer, placement.x, placement.y, { width: placement.width });
      return true;
    } catch (error) {
      // A corrupt image must not fail the whole PDF.
      this.logger.warn(
        `Failed to embed template image in PDF: ${error.message}`,
      );
      return false;
    }
  }

  private color(value: string | undefined, fallback: string): string {
    return typeof value === 'string' && HEX_COLOR_PATTERN.test(value)
      ? value
      : fallback;
  }
}
