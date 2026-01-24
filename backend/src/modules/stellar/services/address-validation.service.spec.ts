import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { AddressValidationService } from './address-validation.service';
import { StellarNetwork } from '../dto/address-validation.dto';

describe('AddressValidationService', () => {
  let service: AddressValidationService;
  let configService: ConfigService;
  let cache: Cache;

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockCache = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    reset: jest.fn(),
    store: {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      keys: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressValidationService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCache,
        },
      ],
    }).compile();

    service = module.get<AddressValidationService>(AddressValidationService);
    configService = module.get<ConfigService>(ConfigService);
    cache = module.get<Cache>(CACHE_MANAGER);

    // Mock config values
    mockConfigService.get.mockImplementation((key: string, defaultValue?: any) => {
      const configMap = {
        'STELLAR_HORIZON_PUBLIC_URL': 'https://horizon.stellar.org',
        'STELLAR_HORIZON_TESTNET_URL': 'https://horizon-testnet.stellar.org',
        'STELLAR_CACHE_TTL': 300000,
        'STELLAR_CACHE_MAX_SIZE': 1000,
        'STELLAR_RATE_LIMIT_RPS': 10,
        'STELLAR_RATE_LIMIT_BURST': 20,
      };
      return configMap[key] || defaultValue;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validate', () => {
    it('should validate a correct Stellar address format', async () => {
      const validAddress = 'GD5J7YFQGYVFSJ4G6LXJZT5Y2E5Z2X7ZQ2K7X7ZQ2K7X7ZQ2K7X7ZQ';
      
      // Mock the Horizon.isValidAddress to return true
      jest.spyOn(require('@stellar/stellar-sdk').Horizon, 'isValidAddress').mockReturnValue(true);

      const result = await service.validate({
        address: validAddress,
        network: StellarNetwork.PUBLIC,
        checkExists: false,
      });

      expect(result.isValid).toBe(true);
      expect(result.isFormatValid).toBe(true);
      expect(result.isChecksumValid).toBe(true);
      expect(result.isNetworkValid).toBe(true);
      expect(result.accountExists).toBeUndefined();
    });

    it('should reject invalid address format', async () => {
      const invalidAddress = 'INVALID_ADDRESS';
      
      const result = await service.validate({
        address: invalidAddress,
        network: StellarNetwork.PUBLIC,
        checkExists: false,
      });

      expect(result.isValid).toBe(false);
      expect(result.isFormatValid).toBe(false);
      expect(result.error).toBe('Invalid address format');
    });

    it('should reject address with invalid checksum', async () => {
      const invalidChecksumAddress = 'GD5J7YFQGYVFSJ4G6LXJZT5Y2E5Z2X7ZQ2K7X7ZQ2K7X7ZQ2K7X7ZZ';
      
      // Mock the Horizon.isValidAddress to return false for invalid checksum
      jest.spyOn(require('@stellar/stellar-sdk').Horizon, 'isValidAddress').mockReturnValue(false);

      const result = await service.validate({
        address: invalidChecksumAddress,
        network: StellarNetwork.PUBLIC,
        checkExists: false,
      });

      expect(result.isValid).toBe(false);
      expect(result.isFormatValid).toBe(true);
      expect(result.isChecksumValid).toBe(false);
      expect(result.error).toBe('Invalid checksum');
    });
  });

  describe('validateAndCheckExists', () => {
    it('should validate address and check existence', async () => {
      const validAddress = 'GD5J7YFQGYVFSJ4G6LXJZT5Y2E5Z2X7ZQ2K7X7ZQ2K7X7ZQ2K7X7ZQ';
      
      // Mock Horizon.isValidAddress
      jest.spyOn(require('@stellar/stellar-sdk').Horizon, 'isValidAddress').mockReturnValue(true);
      
      // Mock cache miss
      mockCache.get.mockResolvedValue(null);
      
      // Mock Horizon server loadAccount
      const mockAccount = {
        id: validAddress,
        sequence: '12345',
        subentry_count: 0,
        thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
        flags: { auth_required: false, auth_revocable: false, auth_immutable: false },
        balances: [{ asset_type: 'native', balance: '1000.0000000' }],
        signers: [{ key: validAddress, weight: 1 }],
        toJSONObject: jest.fn().mockReturnValue({
          id: validAddress,
          sequence: '12345',
          subentry_count: 0,
          thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
          flags: { auth_required: false, auth_revocable: false, auth_immutable: false },
          balances: [{ asset_type: 'native', balance: '1000.0000000' }],
          signers: [{ key: validAddress, weight: 1 }],
        }),
      };

      // Mock the Server class and its methods
      const mockServer = {
        loadAccount: jest.fn().mockResolvedValue(mockAccount),
      };

      // Mock the Server constructor
      jest.doMock('@stellar/stellar-sdk', () => ({
        Server: jest.fn().mockImplementation(() => mockServer),
        Horizon: {
          isValidAddress: jest.fn().mockReturnValue(true),
        },
      }));

      const result = await service.validateAndCheckExists(validAddress, StellarNetwork.PUBLIC);

      expect(result.isValid).toBe(true);
      expect(result.isFormatValid).toBe(true);
      expect(result.isChecksumValid).toBe(true);
      expect(result.isNetworkValid).toBe(true);
      expect(result.accountExists).toBe(true);
      expect(result.accountDetails).toBeDefined();
    });

    it('should handle non-existent account', async () => {
      const nonExistentAddress = 'GD5J7YFQGYVFSJ4G6LXJZT5Y2E5Z2X7ZQ2K7X7ZQ2K7X7ZQ2K7X7XX';
      
      // Mock Horizon.isValidAddress
      jest.spyOn(require('@stellar/stellar-sdk').Horizon, 'isValidAddress').mockReturnValue(true);
      
      // Mock cache miss
      mockCache.get.mockResolvedValue(null);
      
      // Mock Horizon server loadAccount to throw 404 error
      const mockServer = {
        loadAccount: jest.fn().mockRejectedValue({ response: { status: 404 } }),
      };

      jest.doMock('@stellar/stellar-sdk', () => ({
        Server: jest.fn().mockImplementation(() => mockServer),
        Horizon: {
          isValidAddress: jest.fn().mockReturnValue(true),
        },
      }));

      const result = await service.validateAndCheckExists(nonExistentAddress, StellarNetwork.PUBLIC);

      expect(result.isValid).toBe(true);
      expect(result.accountExists).toBe(false);
      expect(result.accountDetails).toBeUndefined();
    });
  });

  describe('validateBulk', () => {
    it('should validate multiple addresses', async () => {
      const addresses = [
        'GD5J7YFQGYVFSJ4G6LXJZT5Y2E5Z2X7ZQ2K7X7ZQ2K7X7ZQ2K7X7ZQ', // Valid
        'INVALID_ADDRESS', // Invalid format
      ];
      
      // Mock Horizon.isValidAddress
      jest.spyOn(require('@stellar/stellar-sdk').Horizon, 'isValidAddress').mockReturnValue(true);

      const result = await service.validateBulk({
        addresses,
        network: StellarNetwork.PUBLIC,
        checkExists: false,
      });

      expect(result.total).toBe(2);
      expect(result.valid).toBe(1);
      expect(result.invalid).toBe(1);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].isValid).toBe(true);
      expect(result.results[1].isValid).toBe(false);
    });
  });

  describe('clearCache', () => {
    it('should clear the cache', async () => {
      mockCache.reset.mockResolvedValue(undefined);

      await service.clearCache();

      expect(mockCache.reset).toHaveBeenCalled();
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', () => {
      const stats = service.getCacheStats();

      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('ttl');
      expect(stats).toHaveProperty('maxSize');
      expect(stats.ttl).toBe(300000);
      expect(stats.maxSize).toBe(1000);
    });
  });
});
