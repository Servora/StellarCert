import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs/promises';
import * as path from 'path';
import { LoggingService } from '../../../common/logging/logging.service';
import {
  DistributedLockService,
  cronLockKey,
} from '../../../common/services/distributed-lock.service';

const TEMP_FILE_CLEANUP_LOCK = cronLockKey('temp-file-cleanup');
const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CleanupService {
  private readonly tempDir = path.join(process.cwd(), 'temp');

  constructor(
    private readonly logger: LoggingService,
    private readonly distributedLock: DistributedLockService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCleanup(): Promise<void> {
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

      let files: string[];

      try {
        files = await fs.readdir(this.tempDir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return;
        }

        throw error;
      }

      const now = Date.now();

      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        const stats = await fs.stat(filePath);

        if (now - stats.mtimeMs <= ONE_DAY_IN_MS) {
          continue;
        }

        await fs.unlink(filePath);
        this.logger.log(`Deleted old temp file: ${file}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;

      this.logger.error(`Error during cleanup: ${message}`, stack);
    } finally {
      await this.distributedLock.release(TEMP_FILE_CLEANUP_LOCK, lockToken);
    }
  }
}
