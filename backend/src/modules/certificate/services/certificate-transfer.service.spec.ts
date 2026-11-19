import { CertificateTransferService } from './certificate-transfer.service';
import {
  CONFIRMATION_CODE_LENGTH,
  MAX_CONFIRMATION_CODE_ATTEMPTS,
} from './certificate-transfer.service';
import { TransferStatus } from '../entities/certificate-transfer.entity';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { UserRole } from '../../../common/constants/roles';

describe('CertificateTransferService', () => {
  let service: CertificateTransferService;
  let transferRepo: any;
  let certRepo: any;
  let auditService: any;
  let notificationsService: any;
  let logger: any;
  let userRepo: any;
  let emailService: any;
  let users: any[];

  beforeEach(() => {
    users = [
      {
        id: 'user-owner',
        email: 'newowner@example.com',
        firstName: 'New',
        lastName: 'Owner',
        isEmailVerified: true,
      },
      {
        id: 'user-unverified',
        email: 'unverified@example.com',
        firstName: 'Un',
        lastName: 'Verified',
        isEmailVerified: false,
      },
      {
        id: 'user-stranger',
        email: 'stranger@example.com',
        firstName: 'Some',
        lastName: 'Stranger',
        isEmailVerified: true,
      },
    ];

    transferRepo = {
      create: jest.fn((dto) => ({ id: 'transfer-1', ...dto })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      findOne: jest.fn(),
      query: jest.fn(),
    };

    certRepo = {
      findOne: jest.fn(),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    notificationsService = {
      createNotification: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    };

    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    userRepo = {
      findOne: jest.fn(({ where }: any) => {
        if (!where) return Promise.resolve(null);
        if (where.email) {
          return Promise.resolve(
            users.find((u) => u.email === where.email) ?? null,
          );
        }
        if (where.id) {
          return Promise.resolve(users.find((u) => u.id === where.id) ?? null);
        }
        return Promise.resolve(null);
      }),
    };

    emailService = {
      sendTransferConfirmationCode: jest.fn().mockResolvedValue(undefined),
      sendTransferCompletedNotice: jest.fn().mockResolvedValue(undefined),
    };

    service = new CertificateTransferService(
      transferRepo,
      certRepo,
      auditService,
      notificationsService,
      logger,
      userRepo,
      emailService,
    );
  });

  describe('initiateTransfer', () => {
    it('sends confirmation code to toEmail (notification & email), not initiator', async () => {
      const mockCert = {
        id: 'cert-1',
        title: 'Blockchain Certified Developer',
        issuerId: 'issuer-1',
        recipientEmail: 'old@example.com',
        recipientName: 'Old Owner',
        status: 'active',
      };
      certRepo.findOne.mockResolvedValue(mockCert);

      const recipientUser = {
        id: 'user-recipient-99',
        email: 'newowner@example.com',
        firstName: 'New',
        lastName: 'Owner',
      };
      userRepo.findOne.mockResolvedValue(recipientUser);

      const dto = {
        certificateId: 'cert-1',
        newOwnerEmail: 'newowner@example.com',
        newOwnerName: 'New Owner',
        reason: 'Change of legal name/address',
      };

      const result = await service.initiateTransfer(
        dto,
        { id: 'issuer-1', role: UserRole.ISSUER },
        '127.0.0.1',
      );

      expect(result).toBeDefined();
      // The secret code goes to the new owner by email and must never appear in
      // the API response returned to the initiator.
      const code = (emailService.sendTransferConfirmationCode as jest.Mock).mock
        .calls[0][0].confirmationCode as string;
      expect(code).toEqual(expect.any(String));
      expect(JSON.stringify(result)).not.toContain(code);
      expect(result).not.toHaveProperty('confirmationCode');

      // 1. Initiator notification must NOT contain confirmationCode
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        'issuer-1',
        NotificationType.INFO,
        'Certificate Transfer Initiated',
        expect.not.stringContaining(code),
      );

      // 2. Intended recipient user notification MUST contain confirmationCode
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        'user-recipient-99',
        NotificationType.INFO,
        'Certificate Transfer Confirmation Code',
        expect.stringContaining(code),
      );

      // 3. Email MUST be sent to newOwnerEmail with confirmationCode
      expect(emailService.sendTransferConfirmationCode).toHaveBeenCalledWith({
        to: 'newowner@example.com',
        recipientName: 'New Owner',
        certificateTitle: 'Blockchain Certified Developer',
        certificateId: 'cert-1',
        confirmationCode: code,
      });
    });

    it('issues a long confirmation code', async () => {
      const mockCert = {
        id: 'cert-1',
        title: 'Blockchain Certified Developer',
        issuerId: 'issuer-1',
        recipientEmail: 'old@example.com',
        recipientName: 'Old Owner',
        status: 'active',
      };
      certRepo.findOne.mockResolvedValue(mockCert);
      transferRepo.findOne.mockResolvedValue(null);

      await service.initiateTransfer(
        {
          certificateId: 'cert-1',
          newOwnerEmail: 'newowner@example.com',
          newOwnerName: 'New Owner',
          reason: 'Change of legal name/address',
        },
        { id: 'issuer-1', role: UserRole.ISSUER },
        '127.0.0.1',
      );

      const code = (emailService.sendTransferConfirmationCode as jest.Mock).mock
        .calls[0][0].confirmationCode as string;

      expect(code).toHaveLength(CONFIRMATION_CODE_LENGTH);
      expect(code.length).toBeGreaterThanOrEqual(12);
      expect(code).toMatch(/^[A-Z0-9]+$/);
    });
  });

  describe('approveTransfer', () => {
    const pendingTransfer = () => ({
      id: 'transfer-2',
      certificateId: 'cert-1',
      toEmail: 'NewOwner@Example.com',
      toName: 'New Owner',
      confirmationCode: 'ABC123',
      status: TransferStatus.PENDING,
      failedAttempts: 0,
      certificate: {
        id: 'cert-1',
        title: 'Cert',
        issuerId: 'issuer-1',
        status: 'active',
        metadata: {},
      },
    });

    it('rejects an approver who is not the intended new owner, even with the right code', async () => {
      transferRepo.findOne.mockResolvedValue(pendingTransfer());

      await expect(
        service.approveTransfer(
          'transfer-2',
          'ABC123',
          {
            id: 'user-stranger',
            role: UserRole.USER,
            email: 'stranger@example.com',
          },
          '127.0.0.1',
        ),
      ).rejects.toThrow(
        'Only the intended new owner can approve this transfer',
      );
    });

    it('rejects an admin who is not the intended new owner', async () => {
      transferRepo.findOne.mockResolvedValue(pendingTransfer());

      await expect(
        service.approveTransfer(
          'transfer-2',
          'ABC123',
          { id: 'user-stranger', role: UserRole.ADMIN },
          '127.0.0.1',
        ),
      ).rejects.toThrow(
        'Only the intended new owner can approve this transfer',
      );
    });

    it('rejects an approver whose account email is not verified', async () => {
      const transfer = pendingTransfer();
      transfer.toEmail = 'unverified@example.com';
      transferRepo.findOne.mockResolvedValue(transfer);

      await expect(
        service.approveTransfer(
          'transfer-2',
          'ABC123',
          {
            id: 'user-unverified',
            role: UserRole.USER,
            email: 'unverified@example.com',
          },
          '127.0.0.1',
        ),
      ).rejects.toThrow(
        'Your email address must be verified before you can approve a certificate transfer',
      );
    });

    it('rejects an approver whose stored account email differs from the token email', async () => {
      const transfer = pendingTransfer();
      transferRepo.findOne.mockResolvedValue(transfer);

      await expect(
        service.approveTransfer(
          'transfer-2',
          'ABC123',
          {
            id: 'user-stranger',
            role: UserRole.USER,
            email: 'newowner@example.com',
          },
          '127.0.0.1',
        ),
      ).rejects.toThrow(
        'Only the intended new owner can approve this transfer',
      );
    });

    it('lets the intended new owner approve (email compared case-insensitively)', async () => {
      const transfer = pendingTransfer();
      transferRepo.findOne.mockResolvedValue(transfer);
      certRepo.findOne.mockResolvedValue(transfer.certificate);

      await expect(
        service.approveTransfer(
          'transfer-2',
          'ABC123',
          {
            id: 'user-owner',
            role: UserRole.USER,
            email: 'newowner@example.com',
          },
          '127.0.0.1',
        ),
      ).resolves.toBeDefined();
    });

    it('rejects an empty confirmation code instead of approving', async () => {
      const transfer = pendingTransfer();
      transferRepo.findOne.mockResolvedValue(transfer);
      // Real Postgres shape for UPDATE ... RETURNING: [rows, affectedCount].
      transferRepo.query.mockResolvedValue([[{ failedAttempts: 1 }], 1]);

      await expect(
        service.approveTransfer(
          'transfer-2',
          '',
          {
            id: 'user-owner',
            role: UserRole.USER,
            email: 'newowner@example.com',
          },
          '127.0.0.1',
        ),
      ).rejects.toThrow('Invalid confirmation code');

      expect(certRepo.save).not.toHaveBeenCalled();
    });

    it('counts a wrong confirmation code and reports the remaining attempts', async () => {
      const transfer = pendingTransfer();
      transferRepo.findOne.mockResolvedValue(transfer);
      // Real Postgres shape for UPDATE ... RETURNING: [rows, affectedCount].
      transferRepo.query.mockResolvedValue([[{ failedAttempts: 1 }], 1]);

      await expect(
        service.approveTransfer(
          'transfer-2',
          'WRONG1',
          {
            id: 'user-owner',
            role: UserRole.USER,
            email: 'newowner@example.com',
          },
          '127.0.0.1',
        ),
      ).rejects.toThrow(
        `Invalid confirmation code. ${
          MAX_CONFIRMATION_CODE_ATTEMPTS - 1
        } attempt(s) remaining before this transfer is locked.`,
      );

      expect(transferRepo.query).toHaveBeenCalled();
      expect(certRepo.save).not.toHaveBeenCalled();
    });

    it('locks the transfer after too many wrong confirmation codes', async () => {
      const transfer = pendingTransfer();
      transferRepo.findOne.mockResolvedValue(transfer);

      let attempts = 0;
      transferRepo.query.mockImplementation(() => {
        attempts += 1;
        // Real Postgres shape for UPDATE ... RETURNING: [rows, affectedCount].
        return Promise.resolve([[{ failedAttempts: attempts }], 1]);
      });

      for (let i = 0; i < MAX_CONFIRMATION_CODE_ATTEMPTS - 1; i++) {
        await expect(
          service.approveTransfer(
            'transfer-2',
            'WRONG1',
            {
              id: 'user-owner',
              role: UserRole.USER,
              email: 'newowner@example.com',
            },
            '127.0.0.1',
          ),
        ).rejects.toThrow('Invalid confirmation code');
      }

      await expect(
        service.approveTransfer(
          'transfer-2',
          'WRONG1',
          {
            id: 'user-owner',
            role: UserRole.USER,
            email: 'newowner@example.com',
          },
          '127.0.0.1',
        ),
      ).rejects.toThrow('Too many invalid confirmation code attempts');

      const saved = transferRepo.save.mock.calls.at(-1)?.[0];
      expect(saved.status).toBe(TransferStatus.LOCKED);
      expect(saved.lockedAt).toBeInstanceOf(Date);
      expect(saved.failedAttempts).toBe(MAX_CONFIRMATION_CODE_ATTEMPTS);
    });

    it('refuses to approve a locked transfer even with the right code', async () => {
      const transfer = pendingTransfer();
      transfer.status = TransferStatus.LOCKED;
      transferRepo.findOne.mockResolvedValue(transfer);

      await expect(
        service.approveTransfer(
          'transfer-2',
          'ABC123',
          {
            id: 'user-owner',
            role: UserRole.USER,
            email: 'newowner@example.com',
          },
          '127.0.0.1',
        ),
      ).rejects.toThrow('Transfer is locked after too many invalid');
    });

    it('notifies both approver and recipient (toEmail) on completion', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        certificateId: 'cert-1',
        fromEmail: 'old@example.com',
        fromName: 'Old Owner',
        toEmail: 'newowner@example.com',
        toName: 'New Owner',
        confirmationCode: '123456',
        status: TransferStatus.PENDING,
        failedAttempts: 0,
        certificate: {
          id: 'cert-1',
          title: 'Blockchain Certified Developer',
          issuerId: 'issuer-1',
          recipientEmail: 'old@example.com',
          recipientName: 'Old Owner',
          status: 'active',
          metadata: {},
        },
      };

      transferRepo.findOne.mockResolvedValue(mockTransfer);
      certRepo.findOne.mockResolvedValue(mockTransfer.certificate);

      await service.approveTransfer(
        'transfer-1',
        '123456',
        {
          id: 'user-owner',
          role: UserRole.USER,
          email: 'newowner@example.com',
        },
        '127.0.0.1',
      );

      // Approver notification
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        'user-owner',
        NotificationType.SUCCESS,
        'Certificate Transfer Completed',
        expect.stringContaining('newowner@example.com'),
      );

      // Recipient user notification
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        'user-owner',
        NotificationType.SUCCESS,
        'Certificate Transfer Completed',
        expect.stringContaining('successfully transferred to your account'),
      );

      // Completion email to new owner
      expect(emailService.sendTransferCompletedNotice).toHaveBeenCalledWith({
        to: 'newowner@example.com',
        recipientName: 'New Owner',
        certificateTitle: 'Blockchain Certified Developer',
        certificateId: 'cert-1',
      });
    });
  });
});
