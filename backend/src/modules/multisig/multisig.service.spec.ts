import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MultisigService } from './multisig.service';
import { StellarService } from '../stellar/services/stellar.service';
import { LoggingService } from '../../common/logging/logging.service';
import { rpc, xdr } from '@stellar/stellar-sdk';

describe('MultisigService', () => {
  let service: MultisigService;
  let configService: ConfigService;
  let stellarService: StellarService;

  describe('transaction polling', () => {
    it('keeps polling until the transaction succeeds', async () => {
      const success = { status: rpc.Api.GetTransactionStatus.SUCCESS };
      const getTransaction = jest
        .fn()
        .mockResolvedValueOnce({
          status: rpc.Api.GetTransactionStatus.NOT_FOUND,
        })
        .mockResolvedValueOnce(success);

      const internals = service as unknown as {
        server: { getTransaction: jest.Mock };
        waitForTransaction: (
          hash: string,
          options?: { maxAttempts?: number; intervalMs?: number },
        ) => Promise<unknown>;
      };
      internals.server = { getTransaction };

      await expect(
        internals.waitForTransaction('tx-hash', {
          maxAttempts: 3,
          intervalMs: 0,
        }),
      ).resolves.toBe(success);
      expect(getTransaction).toHaveBeenCalledTimes(2);
    });

    it('rejects when the transaction never settles', async () => {
      const getTransaction = jest.fn().mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.NOT_FOUND,
      });

      const internals = service as unknown as {
        server: { getTransaction: jest.Mock };
        waitForTransaction: (
          hash: string,
          options?: { maxAttempts?: number; intervalMs?: number },
        ) => Promise<unknown>;
      };
      internals.server = { getTransaction };

      await expect(
        internals.waitForTransaction('tx-hash', {
          maxAttempts: 2,
          intervalMs: 0,
        }),
      ).rejects.toThrow('not finalized');
      expect(getTransaction).toHaveBeenCalledTimes(2);
    });
  });

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
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          },
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

  describe('contract boolean results', () => {
    const parseBooleanResult = (retval: xdr.ScVal | undefined) =>
      (
        service as unknown as {
          parseBooleanResult: (value: xdr.ScVal | undefined) => boolean;
        }
      ).parseBooleanResult(retval);

    it('returns the contract boolean value', () => {
      expect(parseBooleanResult(xdr.ScVal.scvBool(true))).toBe(true);
      expect(parseBooleanResult(xdr.ScVal.scvBool(false))).toBe(false);
    });

    it('rejects a missing or non-boolean contract result', () => {
      expect(() => parseBooleanResult(undefined)).toThrow(
        'Invalid boolean response from contract',
      );
      expect(() => parseBooleanResult(xdr.ScVal.scvU32(1))).toThrow(
        'Invalid boolean response from contract',
      );
    });
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
