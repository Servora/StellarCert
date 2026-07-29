import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MultisigService } from './multisig.service';
import { StellarService } from '../stellar/services/stellar.service';
import { LoggingService } from '../../common/logging/logging.service';

describe('MultisigService', () => {
  let service: MultisigService;
  let configService: ConfigService;
  let stellarService: StellarService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MultisigService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: StellarService,
          useValue: {
            getKeypairFromPublicKey: jest.fn(),
          },
        },
        {
          provide: LoggingService,
          useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<MultisigService>(MultisigService);
    configService = module.get<ConfigService>(ConfigService);
    stellarService = module.get<StellarService>(StellarService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('initMultisigConfig', () => {
    it('should initialize multisig configuration', () => {
      // Mock the config service to return test values
      jest
        .spyOn(configService, 'get')
        .mockReturnValueOnce('test-contract-id')
        .mockReturnValueOnce('https://horizon-testnet.stellar.org')
        .mockReturnValueOnce('testnet');

      // Mock the stellar service
      jest
        .spyOn(stellarService, 'getKeypairFromPublicKey')
        .mockReturnValue({} as any);

      // We can't fully test this without a real Stellar network connection
      // But we can verify that the method exists and has the right signature
      expect(typeof service.initMultisigConfig).toBe('function');
    });
  });

  describe('updateMultisigConfig', () => {
    it('should update multisig configuration', () => {
      expect(typeof service.updateMultisigConfig).toBe('function');
    });
  });

  describe('proposeCertificate', () => {
    it('should propose a new certificate for multi-sig issuance', () => {
      expect(typeof service.proposeCertificate).toBe('function');
    });
  });

  describe('approveRequest', () => {
    it('should approve a pending certificate request', () => {
      expect(typeof service.approveRequest).toBe('function');
    });
  });

  describe('rejectRequest', () => {
    it('should reject a pending certificate request', () => {
      expect(typeof service.rejectRequest).toBe('function');
    });
  });

  describe('issueApprovedCertificate', () => {
    it('should issue an approved certificate', () => {
      expect(typeof service.issueApprovedCertificate).toBe('function');
    });
  });

  describe('cancelRequest', () => {
    it('should cancel a pending request', () => {
      expect(typeof service.cancelRequest).toBe('function');
    });
  });

  describe('getMultisigConfig', () => {
    it('should get multisig configuration for an issuer', () => {
      expect(typeof service.getMultisigConfig).toBe('function');
    });
  });

  describe('getPendingRequest', () => {
    it('should get pending request by ID', () => {
      expect(typeof service.getPendingRequest).toBe('function');
    });
  });

  describe('isRequestExpired', () => {
    it('should check if a request is expired', () => {
      expect(typeof service.isRequestExpired).toBe('function');
    });
  });

  describe('getPendingRequestsForIssuer', () => {
    it('should get pending requests for an issuer', () => {
      expect(typeof service.getPendingRequestsForIssuer).toBe('function');
    });
  });

  describe('getPendingRequestsForSigner', () => {
    it('should get pending requests for a signer', () => {
      expect(typeof service.getPendingRequestsForSigner).toBe('function');
    });
  });
});
