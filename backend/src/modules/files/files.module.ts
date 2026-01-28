import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { FilesService } from './services/files.service';
import { StorageService } from './services/storage.service';
import { PdfService } from './services/pdf.service';
import { QrCodeService } from './services/qrcode.service';
import { CleanupService } from './services/cleanup.service';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
  ],
  providers: [
    FilesService,
    StorageService,
    PdfService,
    QrCodeService,
    CleanupService,
  ],
  exports: [FilesService],
})
export class FilesModule {}
