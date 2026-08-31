import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { LoggingService } from '../../../common/logging/logging.service';

@Injectable()
export class QrCodeService {
  async generateQrCode(text: string): Promise<Buffer> {
    try {
      return await QRCode.toBuffer(text, {
        errorCorrectionLevel: 'H',
        type: 'png',
        width: 300,
        margin: 1,
      });
    } catch (error) {
      this.logger.error(
        `Failed to generate QR code: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async generateQrCodeDataUrl(text: string): Promise<string> {
    try {
      return await QRCode.toDataURL(text);
    } catch (error) {
      this.logger.error(
        `Failed to generate QR code data URL: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  constructor(private readonly logger: LoggingService) {}
}
