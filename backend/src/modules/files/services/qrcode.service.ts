import { Injectable, Logger } from '@nestjs/common';
import * as QRCode from 'qrcode';

@Injectable()
export class QrCodeService {
  private readonly logger = new Logger(QrCodeService.name);

  async generateQrCode(text: string): Promise<Buffer> {
    try {
      return await QRCode.toBuffer(text, {
          errorCorrectionLevel: 'H',
          type: 'png',
          width: 300,
          margin: 1
      });
    } catch (error) {
      this.logger.error(`Failed to generate QR code: ${error.message}`, error.stack);
      throw error;
    }
  }

  async generateQrCodeDataUrl(text: string): Promise<string> {
      try {
          return await QRCode.toDataURL(text);
      } catch (error) {
          this.logger.error(`Failed to generate QR code data URL: ${error.message}`, error.stack);
          throw error;
      }
  }
}
