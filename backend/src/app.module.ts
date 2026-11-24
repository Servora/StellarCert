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
        if (!redisUrl) {
          return { redis: { host: 'localhost', port: 6379 } };
        }

        const parsed = new URL(redisUrl);
        if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
          throw new Error('REDIS_URL must use the redis:// or rediss:// scheme');
        }

        const database = parsed.pathname.length > 1
          ? Number(parsed.pathname.slice(1))
          : undefined;
        if (database !== undefined && (!Number.isInteger(database) || database < 0)) {
          throw new Error('REDIS_URL database path must be a non-negative integer');
        }

        return {
          redis: {
            host: parsed.hostname,
            port: parsed.port ? Number(parsed.port) : 6379,
            ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
            ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
            ...(database !== undefined ? { db: database } : {}),
            ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
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
