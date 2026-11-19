import { UserRepository } from './user.repository';
import { User } from '../entities/user.entity';

/**
 * #1108 — the invalidation write must (a) happen in a single UPDATE, (b) use
 * `null` rather than `undefined` (TypeORM silently drops undefined keys, which
 * is exactly how the lockout/refresh state survived password resets before),
 * and (c) bump `tokenVersion` so outstanding access tokens die too.
 */
describe('UserRepository', () => {
  let set: jest.Mock;
  let where: jest.Mock;
  let execute: jest.Mock;
  let qbUpdate: jest.Mock;
  let createQueryBuilder: jest.Mock;
  let repository: any;
  let userRepository: UserRepository;

  beforeEach(() => {
    execute = jest.fn().mockResolvedValue({ affected: 1 });
    where = jest.fn().mockReturnValue({ execute });
    set = jest.fn().mockReturnValue({ where });
    qbUpdate = jest.fn().mockReturnValue({ set });
    createQueryBuilder = jest.fn().mockReturnValue({ update: qbUpdate });

    repository = {
      update: jest.fn(),
      createQueryBuilder,
    };
    userRepository = new UserRepository(repository);
  });

  describe('setPasswordAndInvalidateSessions', () => {
    it('clears refresh/reset/lockout state with explicit nulls in one UPDATE', async () => {
      await userRepository.setPasswordAndInvalidateSessions(
        'user-uuid-1',
        'new-hash',
      );

      expect(qbUpdate).toHaveBeenCalledWith(User);
      expect(where).toHaveBeenCalledWith('id = :id', { id: 'user-uuid-1' });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(repository.update).not.toHaveBeenCalled();

      const payload = set.mock.calls[0][0];
      expect(payload).toEqual(
        expect.objectContaining({
          password: 'new-hash',
          refreshToken: null,
          refreshTokenExpires: null,
          passwordResetToken: null,
          passwordResetTokenHash: null,
          passwordResetExpires: null,
          loginAttempts: 0,
          lockedUntil: null,
        }),
      );

      // Regression guard: `undefined` anywhere in the payload would be
      // silently skipped by TypeORM and leave the session/lock usable.
      for (const value of Object.values(payload)) {
        expect(value).not.toBeUndefined();
      }
    });

    it('bumps tokenVersion via a raw increment expression', async () => {
      await userRepository.setPasswordAndInvalidateSessions(
        'user-uuid-1',
        'new-hash',
      );

      const payload = set.mock.calls[0][0];
      expect(payload.tokenVersion).toEqual(expect.any(Function));
      expect(payload.tokenVersion()).toBe('"tokenVersion" + 1');
    });
  });

  describe('resetLoginAttempts', () => {
    it('clears the lock with null (undefined would be skipped)', async () => {
      await userRepository.resetLoginAttempts('user-uuid-1');

      expect(repository.update).toHaveBeenCalledWith('user-uuid-1', {
        loginAttempts: 0,
        lockedUntil: null,
      });
    });
  });
});
