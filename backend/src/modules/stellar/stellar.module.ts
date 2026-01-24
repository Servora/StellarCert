import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { AddressValidationService } from './services/address-validation.service';
import { AddressValidationController } from './controllers/address-validation.controller';

@Module({
  imports: [
    ConfigModule,
    CacheModule.register({
      ttl: 300000, // 5 minutes default TTL
      max: 1000, // Maximum number of items in cache
    }),
  ],
  controllers: [AddressValidationController],
  providers: [AddressValidationService],
  exports: [AddressValidationService],
})
export class StellarModule {}
