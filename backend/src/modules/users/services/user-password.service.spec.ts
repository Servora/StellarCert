import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UserPasswordService } from './user-password.service';
import { UserRepository } from '../repositories/user.repository';
import { EmailQueueService } from '../../email/email-queue.service';
import { LoggingService } from '../../../common/logging/logging.service';
import { User } from '../entities/user.entity';

jest.mock('bcryptjs', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

/**
 * #1108 — changing or resetting a password must invalidate every existing
 * session: the legacy refresh token, the lockout counters and (via
 * tokenVersion) all outstanding access tokens. These tests pin both paths to
 * the session-invalidating repository write and forbid the old plain
 * `update(userId, { password })` behaviour.
 */
describe('UserPasswordService (#1108 session invalidation)', () => {
  let service: UserPasswordService;

  const userRepository = {
    findByIdWithPassword: jest.fn(),
    findByPasswordResetTokenHash: jest.fn(),
    update: jest.fn(),
    setPasswordAndInvalidateSessions: jest.fn(),
  };

  const emailQueueService = {
    queuePasswordReset: jest.fn(),
  };

  const logger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  const user = {
    id: 'user-uuid-1',
    email: 'owner@example.com',
    firstName: 'Ola',
    lastName: 'Ide',
    password: 'old-hash',
  } as User;

  const changeDto = {
    currentPassword: 'CurrentP@ss1',
    newPassword: 'FreshP@ss2',
    confirmPassword: 'FreshP@ss2',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    userRepository.setPasswordAndInvalidateSessions.mockResolvedValue(
      undefined,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserPasswordService,
        { provide: UserRepository, useValue: userRepository },
        { provide: EmailQueueService, useValue: emailQueueService },
        { provide: LoggingService, useValue: logger },
      ],
    }).compile();

    service = module.get<UserPasswordService>(UserPasswordService);
  });

  describe('changePassword', () => {
    it('persists the new password through the session-invalidating write', async () => {
      userRepository.findByIdWithPassword.mockResolvedValue(user);

      const result = await service.changePassword(user.id, changeDto);

      expect(result.message).toBe('Password changed successfully');
      expect(
        userRepository.setPasswordAndInvalidateSessions,
      ).toHaveBeenCalledWith(user.id, 'new-hash');
      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it('rejects a wrong current password without touching the account', async () => {
      userRepository.findByIdWithPassword.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.changePassword(user.id, changeDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(
        userRepository.setPasswordAndInvalidateSessions,
      ).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown user', async () => {
      userRepository.findByIdWithPassword.mockResolvedValue(null);

      await expect(
        service.changePassword('missing-id', changeDto),
      ).rejects.toThrow(NotFoundException);
      expect(
        userRepository.setPasswordAndInvalidateSessions,
      ).not.toHaveBeenCalled();
    });

    it('rejects mismatched confirmation before doing anything', async () => {
      await expect(
        service.changePassword(user.id, {
          ...changeDto,
          confirmPassword: 'DifferentP@ss2',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(
        userRepository.setPasswordAndInvalidateSessions,
      ).not.toHaveBeenCalled();
      expect(userRepository.findByIdWithPassword).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const resetDto = {
      token: 'plain-reset-token',
      newPassword: 'FreshP@ss2',
      confirmPassword: 'FreshP@ss2',
    };

    function stubUserWithValidResetToken() {
      userRepository.findByPasswordResetTokenHash.mockResolvedValue({
        ...user,
        isPasswordResetTokenValid: jest.fn().mockReturnValue(true),
      });
    }

    it('persists the new password through the session-invalidating write', async () => {
      stubUserWithValidResetToken();

      const result = await service.resetPassword(resetDto);

      expect(result.message).toBe('Password reset successfully');
      expect(
        userRepository.setPasswordAndInvalidateSessions,
      ).toHaveBeenCalledWith(user.id, 'new-hash');
      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it('rejects an invalid token without touching the account', async () => {
      userRepository.findByPasswordResetTokenHash.mockResolvedValue(null);

      await expect(service.resetPassword(resetDto)).rejects.toThrow(
        'Invalid reset token',
      );
      expect(
        userRepository.setPasswordAndInvalidateSessions,
      ).not.toHaveBeenCalled();
    });

    it('rejects an expired token without touching the account', async () => {
      userRepository.findByPasswordResetTokenHash.mockResolvedValue({
        ...user,
        isPasswordResetTokenValid: jest.fn().mockReturnValue(false),
      });

      await expect(service.resetPassword(resetDto)).rejects.toThrow(
        'Reset token has expired',
      );
      expect(
        userRepository.setPasswordAndInvalidateSessions,
      ).not.toHaveBeenCalled();
    });

    it('rejects mismatched confirmation before looking up the token', async () => {
      await expect(
        service.resetPassword({ ...resetDto, confirmPassword: 'Other' }),
      ).rejects.toThrow(BadRequestException);
      expect(
        userRepository.findByPasswordResetTokenHash,
      ).not.toHaveBeenCalled();
    });
  });
});
