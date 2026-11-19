import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { LoggingService } from '../../../common/logging/logging.service';
import { DistributedLockService } from '../../../common/services/distributed-lock.service';

const TEMP_FILE_CLEANUP_LOCK = 'stellar-cert:cron:temp-file-cleanup';

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);

@Injectable()
export class CleanupService {
  private readonly tempDir = path.join(process.cwd(), 'temp');

  constructor(
    private readonly logger: LoggingService,
    private readonly distributedLock: DistributedLockService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCleanup() {
    const lockToken = await this.distributedLock.acquire(
      TEMP_FILE_CLEANUP_LOCK,
    );
    if (!lockToken) {
      this.logger.log(
        'Skipping temp file cleanup job; another instance owns the lock',
      );
      return;
    }

    try {
      this.logger.log('Running cleanup job for temp files...');

      if (!fs.existsSync(this.tempDir)) {
        return;
      }

      try {
        const files = await readdir(this.tempDir);
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;

        for (const file of files) {
          const filePath = path.join(this.tempDir, file);
          const stats = await stat(filePath);

          if (now - stats.mtimeMs > oneDay) {
            await unlink(filePath);
            this.logger.log(`Deleted old temp file: ${file}`);
          }
        }
      } catch (error) {
        this.logger.error(
          `Error during cleanup: ${error.message}`,
          error.stack,
        );
      }
    } finally {
      await this.distributedLock.release(TEMP_FILE_CLEANUP_LOCK, lockToken);
    }
  }
}
