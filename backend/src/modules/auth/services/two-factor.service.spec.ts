import { Logger, UnauthorizedException } from '@nestjs/common';
import { authenticator } from 'otplib';
import { InMemoryTwoFactorStore, TwoFactorService } from './two-factor.service';

const SECRET = authenticator.generateSecret(20);

function makeCache() {
  const data = new Map<string, unknown>();
  return {
    data,
    get: jest.fn((key: string) => Promise.resolve(data.get(key))),
    set: jest.fn((key: string, value: unknown) => {
      data.set(key, value);
      return Promise.resolve(value);
    }),
    del: jest.fn((key: string) => {
      data.delete(key);
      return Promise.resolve();
    }),
  };
}

function makeRepository() {
  const user = {
    id: 'user-1',
    twoFactorEnabled: true,
    twoFactorSecret: SECRET,
    twoFactorBackupCodes: [] as string[],
  };
  const queryBuilder = {
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(user),
  };
  return {
    user,
    repository: {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      update: jest.fn(),
    },
  };
}

describe('TwoFactorService', () => {
  let nowSpy: jest.SpyInstance;
  let now: number;

  /** Moves the clock for both the service/stores (Date.now) and otplib (explicit epoch). */
  const setNow = (ms: number) => {
    now = ms;
    authenticator.options = { epoch: ms };
  };

  beforeEach(() => {
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    setNow(Date.UTC(2025, 0, 1, 12, 0, 0));
  });

  afterEach(() => {
    nowSpy.mockRestore();
    jest.restoreAllMocks();
    authenticator.resetOptions();
  });

  describe('TOTP replay protection', () => {
    it('accepts a code once and rejects the same code again inside its window', async () => {
      const { repository } = makeRepository();
      const service = new TwoFactorService(
        repository as never,
        makeCache() as never,
      );
      const code = authenticator.generate(SECRET);

      await expect(
        service.validateLogin('user-1', code),
      ).resolves.toBeUndefined();
      await expect(service.validateLogin('user-1', code)).rejects.toThrow(
        'Invalid 2FA token',
      );
    });

    it('accepts the next code once the next time step starts', async () => {
      const { repository } = makeRepository();
      const service = new TwoFactorService(
        repository as never,
        makeCache() as never,
      );

      await service.validateLogin('user-1', authenticator.generate(SECRET));
      setNow(now + 30_000);
      await expect(
        service.validateLogin('user-1', authenticator.generate(SECRET)),
      ).resolves.toBeUndefined();
    });

    it('tracks replays per user', async () => {
      const { repository } = makeRepository();
      const service = new TwoFactorService(
        repository as never,
        makeCache() as never,
      );
      const code = authenticator.generate(SECRET);

      await service.validateLogin('user-1', code);
      await expect(
        service.validateLogin('user-2', code),
      ).resolves.toBeUndefined();
    });

    it('counts a replayed code as a failed attempt', async () => {
      const { repository } = makeRepository();
      const cache = makeCache();
      const service = new TwoFactorService(repository as never, cache as never);
      const code = authenticator.generate(SECRET);

      await service.validateLogin('user-1', code);
      await expect(service.validateLogin('user-1', code)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(cache.data.get('2fa_user_attempts:user-1')).toBe(1);
    });

    it('rejects an invalid code without recording a step', async () => {
      const service = new TwoFactorService(
        makeRepository().repository as never,
        makeCache() as never,
      );

      await expect(
        service.verifyTokenOnce('user-1', '000000', SECRET),
      ).resolves.toBe(false);
    });

    it('applies to disabling 2FA and regenerating backup codes', async () => {
      const { repository } = makeRepository();
      const service = new TwoFactorService(
        repository as never,
        makeCache() as never,
      );
      const code = authenticator.generate(SECRET);

      await expect(
        service.regenerateBackupCodes('user-1', code),
      ).resolves.toEqual({ backupCodes: expect.any(Array) });
      await expect(service.disable('user-1', code)).rejects.toThrow(
        'Invalid TOTP token',
      );
    });
  });

  describe('brute-force lockout without a cache provider', () => {
    it('warns once at startup that it is using per-process memory', () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      new TwoFactorService(makeRepository().repository as never, undefined);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/CACHE_MANAGER is not available/);
    });

    it('does not warn when a cache manager is provided', () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      new TwoFactorService(
        makeRepository().repository as never,
        makeCache() as never,
      );

      expect(warn).not.toHaveBeenCalled();
    });

    it('still locks the account after five wrong codes (fails closed, not open)', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const service = new TwoFactorService(
        makeRepository().repository as never,
        undefined,
      );

      for (let i = 0; i < 4; i++) {
        await expect(
          service.validateLogin('user-1', 'wrong-code'),
        ).rejects.toThrow('Invalid 2FA token');
      }
      await expect(
        service.validateLogin('user-1', 'wrong-code'),
      ).rejects.toThrow(/temporarily locked/);
      // Even the right code is refused while locked.
      await expect(
        service.validateLogin('user-1', authenticator.generate(SECRET)),
      ).rejects.toThrow(/temporarily locked/);
    });

    it('lets the lock expire', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const service = new TwoFactorService(
        makeRepository().repository as never,
        undefined,
      );
      for (let i = 0; i < 5; i++)
        await service
          .validateLogin('user-1', 'wrong-code')
          .catch(() => undefined);

      setNow(now + 5 * 60 * 1000 + 1);

      await expect(
        service.validateLogin('user-1', authenticator.generate(SECRET)),
      ).resolves.toBeUndefined();
    });

    it('replay protection also works with the in-memory fallback', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const service = new TwoFactorService(
        makeRepository().repository as never,
        undefined,
      );
      const code = authenticator.generate(SECRET);

      await service.validateLogin('user-1', code);
      await expect(service.validateLogin('user-1', code)).rejects.toThrow(
        'Invalid 2FA token',
      );
    });
  });

  describe('with a cache manager', () => {
    it('clears the attempt counter after a successful login and locks after five failures', async () => {
      const { repository } = makeRepository();
      const cache = makeCache();
      const service = new TwoFactorService(repository as never, cache as never);

      for (let i = 0; i < 5; i++)
        await service.validateLogin('user-1', 'wrong').catch(() => undefined);
      expect(cache.data.get('2fa_user_lockout:user-1')).toBe(true);
      cache.data.delete('2fa_user_lockout:user-1');

      await service.validateLogin('user-1', authenticator.generate(SECRET));
      expect(cache.data.has('2fa_user_attempts:user-1')).toBe(false);
    });
  });
});

describe('InMemoryTwoFactorStore', () => {
  it('expires entries after their TTL', async () => {
    const start = Date.UTC(2025, 0, 1);
    const spy = jest.spyOn(Date, 'now').mockReturnValue(start);
    const store = new InMemoryTwoFactorStore();

    await store.set('k', 1, 1000);
    expect(await store.get('k')).toBe(1);

    spy.mockReturnValue(start + 1001);
    expect(await store.get('k')).toBeUndefined();
    spy.mockRestore();
  });

  it('deletes entries', async () => {
    const store = new InMemoryTwoFactorStore();
    await store.set('k', 1, 60_000);
    await store.del('k');
    expect(await store.get('k')).toBeUndefined();
  });
});
