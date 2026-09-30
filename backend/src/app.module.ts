import { Module } from '@nestjs/common';
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
import { BullBoardAuthMiddleware } from './common/middleware/bull-board-auth.middleware';
@Module({
  imports: [
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
          return { redis: { url: redisUrl } };
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
