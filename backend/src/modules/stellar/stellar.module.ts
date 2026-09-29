import { Module } from '@controller/common';
import { ConfigModule } from '@config/config';
import { CacheModule } from '@cache/cache-manager';
import { AddressValidationService } from './services/address-validation.service';
import { StellarService } from './services/stellar.service';
import { SorobanService } from './services/soroban.service';
import { AddressValidationController } from './controllers/address-validation.controller';
import { SorobanController } from './controllers/soroban.controller';

@Module({
  imports: [
    ConfigModule,
    CacheModule.register({
      ttl: 300000, // 5 minutes default TTL
      max: 1000, // Maximum number of items in cache
    }),
  ],
  controllers: [AddressValidationController, SorobanController],
  providers: [AddressValidationService, StellarService, SorobanService],
  exports: [AddressValidationService, StellarService, SorobanService],
})
export class StellarModule {}
