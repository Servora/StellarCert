import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { AddressValidationService } from './address-validation.service';
import { StellarNetwork } from '../dto/address-validation.dto';
import { LoggingService } from '../../../common/logging/logging.service';

// A structurally valid Stellar ed25519 public key (all zeroes + valid checksum)
const VALID_ADDRESS =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

describe('AddressValidationService', () => {
  let service: AddressValidationService;
  let configService: ConfigService;
  let cache: Cache;

  const configMap: Record<string, unknown> = {
    STELLAR_HORIZON_PUBLIC_URL: 'https://horizon.stellar.org',
    STELLAR_HORIZON_TESTNET_URL: 'https://horizon-testnet.stellar.org',
    STELLAR_CACHE_TTL: 300000,
    STELLAR_CACHE_MAX_SIZE: 1000,
    STELLAR_RATE_LIMIT_RPS: 10,
    STELLAR_RATE_LIMIT_BURST: 20,
  };

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) =>
        configMap[key] !== undefined ? configMap[key] : defaultValue,
      ),
    };

    const mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      reset: jest.fn(),
      store: {},
    };

    // Config values are available before the module compiles so the service's
    // constructor can initialize the Horizon servers with valid URLs.
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
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AddressValidationService>(AddressValidationService);
    configService = module.get<ConfigService>(ConfigService);
    cache = module.get<Cache>(CACHE_MANAGER);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validate', () => {
    it('should accept a valid Stellar address format', async () => {
      const result = await service.validate({
        address: VALID_ADDRESS,
        network: StellarNetwork.PUBLIC,
        checkExists: false,
      });

      expect(result.isValid).toBe(true);
      expect(result.isFormatValid).toBe(true);
      expect(result.isChecksumValid).toBe(true);
      expect(result.isNetworkValid).toBe(true);
      // checkExists is false, so no account lookup is performed
      expect(result.accountExists).toBe(false);
    });

    it('should reject invalid address format', async () => {
      const result = await service.validate({
        address: 'INVALID_ADDRESS',
        network: StellarNetwork.PUBLIC,
        checkExists: false,
      });

      expect(result.isValid).toBe(false);
      expect(result.isFormatValid).toBe(false);
      expect(result.isChecksumValid).toBe(false);
      expect(result.error).toBe('Invalid address format');
    });

    it('should reject address with invalid checksum', async () => {
      const invalidChecksumAddress =
        VALID_ADDRESS.slice(0, -1) + (VALID_ADDRESS.endsWith('F') ? 'E' : 'F');

      const result = await service.validate({
        address: invalidChecksumAddress,
        network: StellarNetwork.PUBLIC,
        checkExists: false,
      });

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid address format');
    });
  });

  describe('validateAndCheckExists', () => {
    function mockPublicServerLoadAccount(
      value: unknown | (() => Promise<unknown>),
    ): void {
      const server = (service as any).servers.get(StellarNetwork.PUBLIC);
      server.loadAccount = jest
        .fn()
        .mockImplementation(() =>
          typeof value === 'function'
            ? (value as () => Promise<unknown>)()
            : Promise.resolve(value),
        );
    }

    it('should validate address and check existence', async () => {
      const mockAccount = {
        id: VALID_ADDRESS,
        sequence: '12345',
        toJSONObject: jest.fn().mockReturnValue({ id: VALID_ADDRESS }),
      };

      mockPublicServerLoadAccount(mockAccount);

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
      mockPublicServerLoadAccount(() =>
        Promise.reject({ response: { status: 404 }, isError: true }),
      );

      const result = await service.validateAndCheckExists(
        VALID_ADDRESS,
        StellarNetwork.PUBLIC,
      );

      expect(result.isValid).toBe(true);
      expect(result.accountExists).toBe(false);
      expect(result.accountDetails).toBeUndefined();
    });
  });

  describe('validateBulk', () => {
    it('should validate multiple addresses', async () => {
      const result = await service.validateBulk({
        addresses: [VALID_ADDRESS, 'INVALID_ADDRESS'],
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
      const resetSpy = jest
        .spyOn((service as any).cache, 'reset')
        .mockResolvedValue(undefined);

      await service.clearCache();

      expect(resetSpy).toHaveBeenCalled();
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
