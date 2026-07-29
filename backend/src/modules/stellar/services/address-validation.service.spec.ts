import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { AddressValidationService } from './address-validation.service';
import { StellarNetwork } from '../dto/address-validation.dto';
import { LoggingService } from '../../../common/logging/logging.service';

// Real valid Stellar public keys generated via Keypair.random()
const VALID_ADDRESS = 'GDWI2LSFQQAXEGRJRODMNS47BQEYYYVFGMFWEY7DOIXJR2Q4GJDMES2C';
const VALID_ADDRESS_2 = 'GCPYH36NFDYWBRKFTBID33HXGUZNGYBGITLTLW2HEFY2W3EYY66MQSF7';

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
    // Set up config mock BEFORE module compilation so URLs are available
    // when AddressValidationService constructor runs.
    mockConfigService.get.mockImplementation(
      (key: string, defaultValue?: any) => {
        const configMap: Record<string, any> = {
          STELLAR_HORIZON_PUBLIC_URL: 'https://horizon.stellar.org',
          STELLAR_HORIZON_TESTNET_URL: 'https://horizon-testnet.stellar.org',
          STELLAR_CACHE_TTL: 300000,
          STELLAR_CACHE_MAX_SIZE: 1000,
          STELLAR_RATE_LIMIT_RPS: 10,
          STELLAR_RATE_LIMIT_BURST: 20,
        };
        return configMap[key] ?? defaultValue;
      },
    );

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
        {
          provide: LoggingService,
          useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AddressValidationService>(AddressValidationService);
    configService = module.get<ConfigService>(ConfigService);
    cache = module.get<Cache>(CACHE_MANAGER);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validate', () => {
    it('should validate a correct Stellar address format', async () => {
      const result = await service.validate({
        address: VALID_ADDRESS,
        network: StellarNetwork.PUBLIC,
        checkExists: false,
      });

      expect(result.isValid).toBe(true);
      expect(result.isFormatValid).toBe(true);
      expect(result.isChecksumValid).toBe(true);
      expect(result.isNetworkValid).toBe(true);
      // When checkExists is false, accountExists is not populated (remains the
      // default false from the result initializer; no existence check is done).
      expect(result.accountExists).toBe(false);
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
      // The service uses StrKey.isValidEd25519PublicKey which validates both
      // format and checksum in one step. An address that fails this check
      // has isFormatValid = false and isChecksumValid = false.
      const invalidChecksumAddress = 'GD5J7YFQGYVFSJ4G6LXJZT5Y2E5Z2X7ZQ2K7X7ZQ2K7X7ZQ2K7X7ZZ';

      const result = await service.validate({
        address: invalidChecksumAddress,
        network: StellarNetwork.PUBLIC,
        checkExists: false,
      });

      expect(result.isValid).toBe(false);
      expect(result.isFormatValid).toBe(false);
      expect(result.error).toBe('Invalid address format');
    });
  });

  describe('validateAndCheckExists', () => {
    it('should validate address and check existence', async () => {
      const mockAccountDetails = {
        id: VALID_ADDRESS,
        sequence: '12345',
        subentry_count: 0,
        thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
        flags: {
          auth_required: false,
          auth_revocable: false,
          auth_immutable: false,
        },
        balances: [{ asset_type: 'native', balance: '1000.0000000' }],
        signers: [{ key: VALID_ADDRESS, weight: 1 }],
      };

      // Spy on the private checkAccountExists to avoid real network calls
      jest
        .spyOn(service as any, 'checkAccountExists')
        .mockResolvedValue({ exists: true, details: mockAccountDetails });

      const result = await service.validateAndCheckExists(
        VALID_ADDRESS,
        StellarNetwork.PUBLIC,
      );

      expect(result.isValid).toBe(true);
      expect(result.isFormatValid).toBe(true);
      expect(result.isChecksumValid).toBe(true);
      expect(result.isNetworkValid).toBe(true);
      expect(result.accountExists).toBe(true);
      expect(result.accountDetails).toBeDefined();
    });

    it('should handle non-existent account', async () => {
      // Spy on the private checkAccountExists to simulate a missing account
      jest
        .spyOn(service as any, 'checkAccountExists')
        .mockResolvedValue({ exists: false });

      const result = await service.validateAndCheckExists(
        VALID_ADDRESS_2,
        StellarNetwork.PUBLIC,
      );

      expect(result.isValid).toBe(true);
      expect(result.accountExists).toBe(false);
      expect(result.accountDetails).toBeUndefined();
    });
  });

  describe('validateBulk', () => {
    it('should validate multiple addresses', async () => {
      const addresses = [
        VALID_ADDRESS,      // Valid
        'INVALID_ADDRESS',  // Invalid format
      ];

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
    it('should clear the cache without throwing', async () => {
      // The service creates an internal cache (CACHE_MANAGER is not injected),
      // so clearCache() calls reset() on the internal no-op cache object.
      await expect(service.clearCache()).resolves.toBeUndefined();
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
