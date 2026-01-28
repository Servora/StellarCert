import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);
  private readonly tempDir = path.join(process.cwd(), 'temp');

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCleanup() {
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
        this.logger.error(`Error during cleanup: ${error.message}`, error.stack);
    }
  }
}
