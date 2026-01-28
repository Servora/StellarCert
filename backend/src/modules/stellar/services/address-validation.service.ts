import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { Horizon, StrKey } from '@stellar/stellar-sdk';
import {
  AddressValidationOptions,
  ValidationResult,
  CacheEntry,
  HorizonAccountResponse,
  StellarConfig,
} from '../interfaces/address-validation.interface';
import {
  AddressValidationRequest,
  BulkAddressValidationRequest,
  AddressValidationResult,
  BulkAddressValidationResult,
  StellarNetwork,
} from '../dto/address-validation.dto';

@Injectable()
export class AddressValidationService {
  private readonly logger = new Logger(AddressValidationService.name);
  private readonly servers: Map<StellarNetwork, Horizon.Server>;
  private readonly config: StellarConfig;
  private readonly cache: Cache;

  constructor(
    private readonly configService: ConfigService,
    // @Inject(CACHE_MANAGER) cache: Cache,
  ) {
    // this.cache = cache;
    this.cache = {
      get: async (key: string) => null,
      set: async (key: string, value: any, options?: any) => {},
      del: async (key: string) => {},
      reset: async () => {},
      wrap: async (key: string, fn: any) => null,
      store: {
        get: async (key: string) => null,
        set: async (key: string, value: any, options?: any) => {},
        del: async (key: string) => {},
        keys: async () => [],
        reset: async () => {},
        mset: async (args: any) => {},
        mget: async (args: any) => [],
        mdel: async (args: any) => {},
        ttl: async (key: string) => 0,
      },
    } as unknown as Cache;

    this.config = this.loadConfig();
    this.servers = this.initializeServers();
  }

  private loadConfig(): StellarConfig {
    return {
      horizonUrls: {
        public: this.configService.get<string>('STELLAR_HORIZON_PUBLIC_URL', 'https://horizon.stellar.org'),
        testnet: this.configService.get<string>('STELLAR_HORIZON_TESTNET_URL', 'https://horizon-testnet.stellar.org'),
      },
      cache: {
        ttl: this.configService.get<number>('STELLAR_CACHE_TTL', 300000), // 5 minutes
        maxSize: this.configService.get<number>('STELLAR_CACHE_MAX_SIZE', 1000),
      },
      rateLimit: {
        requestsPerSecond: this.configService.get<number>('STELLAR_RATE_LIMIT_RPS', 10),
        burstSize: this.configService.get<number>('STELLAR_RATE_LIMIT_BURST', 20),
      },
    };
  }

  private initializeServers(): Map<StellarNetwork, Horizon.Server> {
    const servers = new Map<StellarNetwork, Horizon.Server>();
    
    servers.set(StellarNetwork.PUBLIC, new Horizon.Server(this.config.horizonUrls.public));
    servers.set(StellarNetwork.TESTNET, new Horizon.Server(this.config.horizonUrls.testnet));

    return servers;
  }

  async validate(request: AddressValidationRequest): Promise<AddressValidationResult> {
    const options: AddressValidationOptions = {
      network: request.network || StellarNetwork.PUBLIC,
      checkExists: request.checkExists || false,
      cacheResults: true,
    };

    const result = await this.validateAddress(request.address, options);
    
    return {
      isValid: result.isValid,
      error: result.error,
      isFormatValid: result.isFormatValid,
      isChecksumValid: result.isChecksumValid,
      isNetworkValid: result.isNetworkValid,
      accountExists: result.accountExists,
      accountDetails: result.accountDetails,
    };
  }

  async validateAndCheckExists(address: string, network: StellarNetwork = StellarNetwork.PUBLIC): Promise<AddressValidationResult> {
    const options: AddressValidationOptions = {
      network,
      checkExists: true,
      cacheResults: true,
    };

    const result = await this.validateAddress(address, options);
    
    return {
      isValid: result.isValid,
      error: result.error,
      isFormatValid: result.isFormatValid,
      isChecksumValid: result.isChecksumValid,
      isNetworkValid: result.isNetworkValid,
      accountExists: result.accountExists,
      accountDetails: result.accountDetails,
    };
  }

  async validateBulk(request: BulkAddressValidationRequest): Promise<BulkAddressValidationResult> {
    const options: AddressValidationOptions = {
      network: request.network || StellarNetwork.PUBLIC,
      checkExists: request.checkExists || false,
      cacheResults: true,
    };

    const validationPromises = request.addresses.map(address => 
      this.validateAddress(address, options)
    );

    const results = await Promise.allSettled(validationPromises);
    
    const validationResults: AddressValidationResult[] = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return {
          isValid: result.value.isValid,
          error: result.value.error,
          isFormatValid: result.value.isFormatValid,
          isChecksumValid: result.value.isChecksumValid,
          isNetworkValid: result.value.isNetworkValid,
          accountExists: result.value.accountExists,
          accountDetails: result.value.accountDetails,
        };
      } else {
        this.logger.error(`Failed to validate address ${request.addresses[index]}:`, result.reason);
        return {
          isValid: false,
          error: 'Validation failed due to server error',
          isFormatValid: false,
          isChecksumValid: false,
          isNetworkValid: false,
        };
      }
    });

    const validCount = validationResults.filter(r => r.isValid).length;
    const invalidCount = validationResults.length - validCount;

    return {
      results: validationResults,
      total: validationResults.length,
      valid: validCount,
      invalid: invalidCount,
    };
  }

  async validateAddress(address: string, options: AddressValidationOptions): Promise<AddressValidationResult> {
    const result: AddressValidationResult = {
      isValid: false,
      error: undefined,
      isFormatValid: false,
      isChecksumValid: false,
      isNetworkValid: false,
      accountExists: false,
      accountDetails: undefined,
    };

    try {
      // 1. Basic Format Validation
      // StrKey.isValidEd25519PublicKey(address) is the correct way to validate addresses in newer SDK
      try {
          if (!StrKey.isValidEd25519PublicKey(address)) {
              result.error = 'Invalid address format';
              return result;
          }
          result.isFormatValid = true;
          result.isChecksumValid = true; 
          result.isValid = true;
      } catch (e) {
           result.error = 'Invalid address format';
           return result;
      }

      // 2. Network Check (if requested)
      result.isNetworkValid = this.validateNetwork(address, options.network);
      if (!result.isNetworkValid) {
        result.error = `Address does not match ${options.network} network`;
        return result;
      }

      result.isValid = true;

      // Step 4: Account existence check (if requested)
      if (options.checkExists) {
        const accountData = await this.checkAccountExists(address, options.network, options.cacheResults);
        result.accountExists = accountData.exists;
        result.accountDetails = accountData.details;
      }

    } catch (error) {
      this.logger.error(`Error validating address ${address}:`, error);
      result.error = error instanceof Error ? error.message : 'Unknown validation error';
    }

    return result;
  }

  private validateNetwork(address: string, network: StellarNetwork): boolean {
    // For Stellar, all addresses use the same format across networks
    // The network distinction is made at the Horizon server level
    // However, we can implement additional logic if needed
    return true;
  }

  private async checkAccountExists(
    address: string, 
    network: StellarNetwork, 
    useCache: boolean
  ): Promise<{ exists: boolean; details?: HorizonAccountResponse }> {
    const cacheKey = `stellar:account:${network}:${address}`;

    if (useCache) {
      try {
        const cached = await this.cache.get<CacheEntry>(cacheKey);
        if (cached && Date.now() - cached.timestamp < cached.ttl) {
          return {
            exists: cached.isValid,
            details: cached.accountDetails,
          };
        }
      } catch (cacheError) {
        this.logger.warn(`Cache retrieval failed for ${address}:`, cacheError);
      }
    }

    try {
      const server = this.servers.get(network);
      if (!server) {
        throw new Error(`Server not configured for network: ${network}`);
      }

      const account = await server.loadAccount(address);
      const accountDetails: HorizonAccountResponse = account as unknown as HorizonAccountResponse;

      const result = {
        exists: true,
        details: accountDetails,
      };

      if (useCache) {
        try {
          await this.cache.set(cacheKey, {
            isValid: true,
            accountExists: true,
            accountDetails,
            timestamp: Date.now(),
            ttl: this.config.cache.ttl,
          }, this.config.cache.ttl);
        } catch (cacheError) {
          this.logger.warn(`Cache storage failed for ${address}:`, cacheError);
        }
      }

      return result;

    } catch (error) {
      if (error instanceof NotFoundException || error.response?.status === 404) {
        const result = { exists: false };

        if (useCache) {
          try {
            await this.cache.set(cacheKey, {
              isValid: false,
              accountExists: false,
              timestamp: Date.now(),
              ttl: this.config.cache.ttl,
            }, this.config.cache.ttl);
          } catch (cacheError) {
            this.logger.warn(`Cache storage failed for ${address}:`, cacheError);
          }
        }

        return result;
      }

      this.logger.error(`Error checking account existence for ${address}:`, error);
      throw error;
    }
  }

  async resetCache(): Promise<void> {
    try {
      if ((this.cache as any).reset) {
        await (this.cache as any).reset();
      }
      this.logger.log('Address validation cache cleared');
    } catch (error) {
      this.logger.error('Failed to clear cache', error);
    }
  }

  getCacheStats(): { size: number; ttl: number; maxSize: number } {
    return {
      size: 0, // Would need to implement cache size tracking
      ttl: this.config.cache.ttl,
      maxSize: this.config.cache.maxSize,
    };
  }
}
