import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from './storage.service';
import { PdfService, CertificateData } from './pdf.service';
import { QrCodeService } from './qrcode.service';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly pdfService: PdfService,
    private readonly qrCodeService: QrCodeService,
  ) {}

  async generateAndUploadCertificate(data: CertificateData): Promise<{ pdfUrl: string; pdfKey: string; qrUrl?: string; qrKey?: string }> {
    // 1. Generate QR Code
    // The QR code usually points to a verification URL
    let qrBuffer: Buffer | undefined;
    let qrKey: string | undefined;
    let qrUrl: string | undefined;

    if (data.verificationUrl) {
        try {
            qrBuffer = await this.qrCodeService.generateQrCode(data.verificationUrl);
            const qrUpload = await this.storageService.uploadFile(qrBuffer, `qr-${data.tokenId || Date.now()}.png`, 'image/png');
            qrKey = qrUpload.key;
            qrUrl = qrUpload.url;
        } catch (error) {
            this.logger.error(`Error generating/uploading QR code: ${error.message}`);
            // Proceed without QR if it fails? Or throw? 
            // Requirements say "Create QR codes", so probably should fail if it fails.
            throw error;
        }
    }

    // 2. Generate PDF with QR Code
    const pdfBuffer = await this.pdfService.generateCertificate({
        ...data,
        qrCodeBuffer: qrBuffer
    });

    // 3. Upload PDF
    const pdfUpload = await this.storageService.uploadFile(pdfBuffer, `cert-${data.tokenId || Date.now()}.pdf`, 'application/pdf');

    return {
        pdfUrl: pdfUpload.url,
        pdfKey: pdfUpload.key,
        qrUrl,
        qrKey
    };
  }
  
  async getFileUrl(key: string): Promise<string> {
      return this.storageService.getSignedUrl(key);
  }
  
  async deleteFile(key: string): Promise<void> {
      return this.storageService.deleteFile(key);
  }
}
