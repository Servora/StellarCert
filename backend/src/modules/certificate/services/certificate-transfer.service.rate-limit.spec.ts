import { HttpException, HttpStatus } from '@nestjs/common';
import { CertificateTransferService } from './certificate-transfer.service';
import {
  InMemoryRateLimitStore,
  type RateLimitEntry,
  type RateLimitStore,
} from '../../../common/guards/ip-rate-limit.guard';
import { TransferStatus } from '../entities/certificate-transfer.entity';

describe('CertificateTransferService confirmation-code rate limiting (#1300)', () => {
  let service: CertificateTransferService;
  let sharedStore: RateLimitStore;
  let transferRepo: any;
  let certRepo: any;
  let auditService: any;
  let notificationsService: any;
  let logger: any;
  let userRepo: any;

  beforeEach(() => {
    const backing = new InMemoryRateLimitStore();
    sharedStore = {
      consume: (key: string, windowMs: number, now: number): Promise<RateLimitEntry> =>
        backing.consume(key, windowMs, now),
      reset: (key: string): Promise<void> => backing.reset(key),
      prune: (now: number): Promise<void> => backing.prune(now),
    };

    transferRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'transfer-1',
        certificateId: 'cert-1',
        fromEmail: 'old@example.com',
        fromName: 'Old Owner',
        toEmail: 'newowner@example.com',
        toName: 'New Owner',
        confirmationCode: 'ABC123DEF456',
        initiatedBy: 'issuer-1',
        expiresAt: new Date(Date.now() + 86_400_000),
        status: TransferStatus.PENDING,
        failedAttempts: 0,
        lockedAt: null,
      }),
      save: jest.fn((entity) => Promise.resolve(entity)),
      query: jest.fn().mockResolvedValue([[{ failedAttempts: 1 }], 1]),
    };

    certRepo = {
      findOne: jest.fn(),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    notificationsService = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };

    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    userRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'user-owner',
        email: 'newowner@example.com',
        isEmailVerified: true,
      }),
    };

    service = new CertificateTransferService(
      transferRepo,
      certRepo,
      auditService,
      notificationsService,
      logger,
      userRepo,
      undefined,
      undefined,
      sharedStore,
    );
  });

  it('throttles rapid wrong-code submissions per IP using the shared RateLimitStore', async () => {
    const approver = { id: 'user-owner', role: 'USER', email: 'newowner@example.com' };

    for (let i = 0; i < 5; i++) {
      await expect(
        service.approveTransfer('transfer-1', 'WRONG0000000', approver, '198.51.100.10'),
      ).rejects.toThrow();
    }

    await expect(
      service.approveTransfer('transfer-1', 'WRONG0000000', approver, '198.51.100.10'),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });

    try {
      await service.approveTransfer('transfer-1', 'WRONG0000000', approver, '198.51.100.10');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });

  it('throttles rapid submissions per account across rotating IPs', async () => {
    const approver = { id: 'user-owner', role: 'USER', email: 'newowner@example.com' };

    for (let i = 0; i < 5; i++) {
      await expect(
        service.approveTransfer('transfer-1', 'WRONG0000000', approver, `198.51.100.${i + 1}`),
      ).rejects.toThrow();
    }

    await expect(
      service.approveTransfer('transfer-1', 'WRONG0000000', approver, '198.51.100.99'),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });
});
