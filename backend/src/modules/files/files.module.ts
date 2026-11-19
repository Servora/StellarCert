import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FilesService } from './services/files.service';
import { StorageService } from './services/storage.service';
import { PdfService } from './services/pdf.service';
import { QrCodeService } from './services/qrcode.service';
import { CleanupService } from './services/cleanup.service';

@Module({
  imports: [ConfigModule],
  providers: [
    FilesService,
    StorageService,
    PdfService,
    QrCodeService,
    CleanupService,
  ],
  exports: [FilesService, StorageService, PdfService, QrCodeService],
})
export class FilesModule {}
