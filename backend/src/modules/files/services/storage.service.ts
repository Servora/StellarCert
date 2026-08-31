import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID as uuidv4 } from 'crypto';
import { extname } from 'path';
import { LoggingService } from '../../../common/logging/logging.service';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly s3Client: S3Client | null = null;
  private readonly bucket: string;
  private readonly isStorageRequired: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggingService,
  ) {
    this.bucket = this.configService.get<string>('STORAGE_BUCKET') ?? '';
    const storageRequiredValue = this.configService.get('STORAGE_REQUIRED');
    this.isStorageRequired =
      storageRequiredValue !== false && storageRequiredValue !== 'false';

    const region = this.configService.get<string>('STORAGE_REGION');
    const endpoint = this.configService.get<string>('STORAGE_ENDPOINT');
    const accessKeyId = this.configService.get<string>('STORAGE_ACCESS_KEY');
    const secretAccessKey =
      this.configService.get<string>('STORAGE_SECRET_KEY');

    if (accessKeyId && secretAccessKey && this.bucket) {
      this.s3Client = new S3Client({
        region: region || 'us-east-1', // Default region if not provided
        endpoint,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        forcePathStyle: true, // Needed for MinIO
      });
      this.logger.log('S3 storage client initialized successfully');
    }
  }

  onModuleInit() {
    if (!this.s3Client) {
      const missingConfig: string[] = [];
      if (!this.configService.get<string>('STORAGE_ACCESS_KEY')) {
        missingConfig.push('STORAGE_ACCESS_KEY');
      }
      if (!this.configService.get<string>('STORAGE_SECRET_KEY')) {
        missingConfig.push('STORAGE_SECRET_KEY');
      }
      if (!this.bucket) {
        missingConfig.push('STORAGE_BUCKET');
      }

      if (this.isStorageRequired) {
        throw new Error(
          `StorageService requires S3 configuration but the following environment variables are missing: ${missingConfig.join(', ')}. ` +
            `Either provide the required storage configuration or set STORAGE_REQUIRED=false to disable storage functionality.`,
        );
      } else {
        this.logger.warn(
          'Storage configuration is incomplete. StorageService will not function correctly. ' +
            `Missing: ${missingConfig.join(', ')}`,
        );
      }
    }
  }

  async uploadFile(
    buffer: Buffer,
    originalFilename: string,
    mimeType: string,
    customKey?: string,
  ): Promise<{ key: string; url: string }> {
    if (!this.s3Client) {
      throw new Error('Storage service is not configured');
    }

    // Use custom key if provided, otherwise generate one
    const key = customKey || `${uuidv4()}${extname(originalFilename)}`;

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
        }),
      );

      const url = await this.getSignedUrl(key);
      return { key, url };
    } catch (error) {
      this.logger.error(`Failed to upload file: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    if (!this.s3Client) {
      throw new Error('Storage service is not configured');
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      return await getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (error) {
      this.logger.error(
        `Failed to get signed URL: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async deleteFile(key: string): Promise<void> {
    if (!this.s3Client) {
      throw new Error('Storage service is not configured');
    }

    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (error) {
      this.logger.error(`Failed to delete file: ${error.message}`, error.stack);
      throw error;
    }
  }
}
