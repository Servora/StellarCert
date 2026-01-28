import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CertificatesModule } from './modules/certificates/certificates.module';
import { IssuersModule } from './modules/issuers/issuers.module';
import { HealthModule } from './modules/health/health.module';
import { CommonModule } from './common/common.module';
import { EmailModule } from './modules/email/email.module';
import { typeOrmConfig } from './config/typeorm.config';
import { validateEnv } from './config/environment.config';
import { CertificateModule } from './certificate/certificate.module';
import { StellarModule } from './modules/stellar/stellar.module';
import { FilesModule } from './modules/files/files.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
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
    TypeOrmModule.forRoot(typeOrmConfig),
    CommonModule,
    HealthModule,
    AuthModule,
    UsersModule,
    CertificatesModule,
    IssuersModule,
    CertificateModule,
    StellarModule,
    EmailModule,
    FilesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
