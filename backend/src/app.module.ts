import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CertificatesModule } from './modules/certificates/certificates.module';
import { IssuersModule } from './modules/issuers/issuers.module';
import { HealthModule } from './modules/health/health.module';
import { CommonModule } from './common/common.module';
import { typeOrmConfig } from './config/typeorm.config';
import { validateEnv } from './config/environment.config';
import { CertificateModule } from './certificate/certificate.module';
import { StellarModule } from './modules/stellar/stellar.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
