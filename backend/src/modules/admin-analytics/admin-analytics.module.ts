import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { AdminAnalyticsController } from './controllers/admin-analytics.controller';
import { AdminAnalyticsService } from './services/admin-analytics.service';
import { User } from '../users/entities/user.entity';
import { Certificate } from '../certificate/entities/certificate.entity';
import { Verification } from '../certificate/entities/verification.entity';
import { Issuer } from '../issuers/entities/issuer.entity';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { CertificateModule } from '../certificate/certificate.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Certificate, Verification, Issuer]),
    CacheModule.register({
      // cache-manager v5+ (installed: v7) interprets `ttl` in MILLISECONDS, so a
      // bare 120 would have meant 120 ms instead of the intended 2 minutes.
      ttl: 120_000, // 2 minutes in milliseconds
      max: 100,
    }),
    AuthModule,
    UsersModule,
    CertificateModule,
  ],
  controllers: [AdminAnalyticsController],
  providers: [AdminAnalyticsService],
  exports: [AdminAnalyticsService],
})
export class AdminAnalyticsModule {}
