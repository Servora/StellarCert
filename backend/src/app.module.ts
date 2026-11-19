import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { resolve } from 'path';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { IssuersModule } from './modules/issuers/issuers.module';
import { HealthModule } from './modules/health/health.module';
import { CommonModule } from './common/common.module';
import { BullBoardAuthMiddleware } from './common/middleware/bull-board-auth.middleware';
import { EmailModule } from './modules/email/email.module';
import { typeOrmConfig } from './config/typeorm.config';
import { validateEnv } from './config/environment.config';
import { CertificateModule } from './modules/certificate/certificate.module';
import { StellarModule } from './modules/stellar/stellar.module';
import { FilesModule } from './modules/files/files.module';
import { VersioningModule } from './common/versioning/versioning.module';
import { AuditModule } from './modules/audit/audit.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { MetadataSchemaModule } from './modules/metadata-schema/metadata-schema.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminAnalyticsModule } from './modules/admin-analytics/admin-analytics.module';
import { SecurityModule } from './modules/security/security.module';
import { MultisigModule } from './modules/multisig/multisig.module';
import { RateLimitStoreModule } from './common/rate-limiting/rate-limit-store.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: [resolve(__dirname, '../../.env'), '.env'],
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        if (redisUrl) {
          // ioredis's RedisOptions has no `url` key: passing `{ url }` as an
          // options object is silently ignored, leaving the client to connect
          // to its default 127.0.0.1:6379 with no password instead of the
          // configured host. Parse the URL into host/port/password explicitly.
          const parsed = new URL(redisUrl);
          return {
            redis: {
              host: parsed.hostname,
              port: Number(parsed.port) || 6379,
              password: parsed.password || undefined,
            },
          };
        }
        return {
          redis: {
            host: 'localhost',
            port: 6379,
          },
        };
      },
    }),
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
      // Nest guards never run on Bull Board's own Express mount, so the
      // dashboard is protected with a middleware that actually runs there.
      middleware: BullBoardAuthMiddleware,
    }),
    TypeOrmModule.forRoot(typeOrmConfig),
    CommonModule,
    RateLimitStoreModule,
    VersioningModule,
    HealthModule,
    AuthModule,
    UsersModule,
    IssuersModule,
    CertificateModule,
    StellarModule,
    EmailModule,
    FilesModule,
    AuditModule,
    WebhooksModule,
    MetadataSchemaModule,
    NotificationsModule,
    AdminAnalyticsModule,
    SecurityModule,
    MultisigModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
