import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { CertificatesService } from './certificates.service';
import { CertificatesController } from './certificates.controller';
import { Certificate } from './entities/certificate.entity';
import { Verification } from './entities/verification.entity';
import { StellarModule } from '../stellar/stellar.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Certificate, Verification]),
    CacheModule.register(),
    StellarModule,
  ],
  controllers: [CertificatesController],
  providers: [CertificatesService],
  exports: [CertificatesService],
})
export class CertificatesModule { }
