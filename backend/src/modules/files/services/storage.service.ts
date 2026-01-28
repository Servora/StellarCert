import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { extname } from 'path';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.get<string>('STORAGE_BUCKET') ?? '';
    
    const region = this.configService.get<string>('STORAGE_REGION');
    const endpoint = this.configService.get<string>('STORAGE_ENDPOINT');
    const accessKeyId = this.configService.get<string>('STORAGE_ACCESS_KEY');
    const secretAccessKey = this.configService.get<string>('STORAGE_SECRET_KEY');

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
    } else {
        this.logger.warn('Storage configuration missing. StorageService will not function correctly.');
    }
  }

  async uploadFile(buffer: Buffer, originalFilename: string, mimeType: string): Promise<{ key: string; url: string }> {
    if (!this.s3Client) {
        throw new Error('Storage service is not configured');
    }

    const extension = extname(originalFilename);
    const key = `${uuidv4()}${extension}`;
    
    try {
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }));

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
       this.logger.error(`Failed to get signed URL: ${error.message}`, error.stack);
       throw error;
    }
  }
  
  async deleteFile(key: string): Promise<void> {
    if (!this.s3Client) {
        throw new Error('Storage service is not configured');
    }

      try {
          await this.s3Client.send(new DeleteObjectCommand({
              Bucket: this.bucket,
              Key: key,
          }));
      } catch (error) {
          this.logger.error(`Failed to delete file: ${error.message}`, error.stack);
          throw error;
      }
  }
}
