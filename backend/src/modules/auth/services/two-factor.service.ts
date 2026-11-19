import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Inject,
  Optional,
  Logger,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { authenticator } from 'otplib';
import * as qrcode from 'qrcode';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';

const BACKUP_CODE_COUNT = 8;
const LOCKOUT_MS = 5 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
/** How long the last accepted TOTP step is remembered; comfortably longer than the code window. */
const TOTP_STEP_RETENTION_MS = 5 * 60 * 1000;

/** The few cache operations 2FA needs; satisfied by CACHE_MANAGER and by {@link InMemoryTwoFactorStore}. */
export interface TwoFactorStore {
  get<T>(key: string): Promise<T | undefined | null>;
  set(key: string, value: unknown, ttlMs: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/**
 * Per-process fallback used when no cache provider is bound. Attempt counting
 * and replay protection still work, but only within this process, so they are
 * weaker than a shared cache on multi-instance deployments.
 */
export class InMemoryTwoFactorStore implements TwoFactorStore {
  private readonly entries = new Map<
    string,
    { value: unknown; expiresAt: number }
  >();

  get<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return Promise.resolve(undefined);
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(entry.value as T);
  }

  set(key: string, value: unknown, ttlMs: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }
}

@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);
  private readonly store: TwoFactorStore;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @Optional()
    @Inject(CACHE_MANAGER)
    private readonly cacheManager?: Cache,
  ) {
    if (cacheManager) {
      this.store = cacheManager;
    } else {
      // Never fail open: without a cache the lockout and replay checks still
      // run, just against this process's memory.
      this.store = new InMemoryTwoFactorStore();
      this.logger.warn(
        'CACHE_MANAGER is not available: 2FA brute-force lockout and TOTP replay protection fall back to per-process memory and are not shared between instances.',
      );
    }
  }

  /**
   * Generate a new TOTP secret for a user and return the otpauth URI + QR code.
   * Does NOT persist anything — the secret is saved only when the user confirms
   * the token via enable2FA().
   */
  async generateSetup(
    user: User,
  ): Promise<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }> {
    const secret = authenticator.generateSecret(20);
    const otpauthUrl = authenticator.keyuri(user.email, 'StellarCert', secret);
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);
    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  /**
   * Verify a TOTP token against a plain-text secret.
   */
  verifyToken(token: string, secret: string): boolean {
    return authenticator.verify({ token, secret });
  }

  /**
   * Verify a TOTP token and consume its time step for this user. The same code
   * (or any older one) is rejected afterwards, so a code that was observed or
   * logged cannot be replayed inside its validity window.
   */
  async verifyTokenOnce(
    userId: string,
    token: string,
    secret: string,
  ): Promise<boolean> {
    const delta = authenticator.checkDelta(token, secret);
    if (delta === null || delta === undefined) return false;

    // Use the same clock and step length otplib verified the code with.
    const options = authenticator.allOptions();
    const currentStep = Math.floor(
      (options.epoch ?? Date.now()) / 1000 / (options.step ?? 30),
    );
    const step = currentStep + delta;
    const key = `2fa_totp_last_step:${userId}`;
    const lastStep = await this.store.get<number>(key);
    if (typeof lastStep === 'number' && step <= lastStep) return false;

    await this.store.set(key, step, TOTP_STEP_RETENTION_MS);
    return true;
  }

  /**
   * Enable 2FA: verify the submitted token against the provided secret, then
   * persist the secret and generate backup codes.
   */
  async enable(
    userId: string,
    secret: string,
    token: string,
  ): Promise<{ backupCodes: string[] }> {
    if (!this.verifyToken(token, secret)) {
      throw new BadRequestException('Invalid TOTP token');
    }

    const { plainCodes, hashedCodes } = await this.generateBackupCodes();

    await this.userRepository.update(userId, {
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      twoFactorBackupCodes: hashedCodes,
    });

    return { backupCodes: plainCodes };
  }

  /**
   * Disable 2FA after verifying the current TOTP token.
   */
  async disable(userId: string, token: string): Promise<void> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.twoFactorSecret')
      .where('user.id = :id', { id: userId })
      .getOne();

    if (!user?.twoFactorEnabled) {
      throw new BadRequestException('2FA is not enabled');
    }

    if (
      !user.twoFactorSecret ||
      !(await this.verifyTokenOnce(userId, token, user.twoFactorSecret))
    ) {
      throw new UnauthorizedException('Invalid TOTP token');
    }

    await this.userRepository.update(userId, {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
    });
  }

  /**
   * Validate a TOTP token or backup code during login.
   * Returns true if valid, throws otherwise.
   */
  async validateLogin(userId: string, token: string): Promise<void> {
    const lockoutKey = `2fa_user_lockout:${userId}`;
    const attemptsKey = `2fa_user_attempts:${userId}`;
    if (await this.store.get(lockoutKey)) {
      throw new UnauthorizedException(
        'Too many failed 2FA attempts. Account 2FA temporarily locked. Please try again later.',
      );
    }

    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.twoFactorSecret')
      .addSelect('user.twoFactorBackupCodes')
      .where('user.id = :id', { id: userId })
      .getOne();

    if (!user?.twoFactorSecret) {
      throw new UnauthorizedException('2FA not configured');
    }

    // Try TOTP first. A code that was already used is not accepted again.
    if (await this.verifyTokenOnce(userId, token, user.twoFactorSecret)) {
      await this.store.del(attemptsKey);
      return;
    }

    // Try backup codes
    if (user.twoFactorBackupCodes?.length) {
      for (let i = 0; i < user.twoFactorBackupCodes.length; i++) {
        const match = await bcrypt.compare(token, user.twoFactorBackupCodes[i]);
        if (match) {
          // Invalidate the used backup code
          const remaining = [...user.twoFactorBackupCodes];
          remaining.splice(i, 1);
          await this.userRepository.update(userId, {
            twoFactorBackupCodes: remaining,
          });
          await this.store.del(attemptsKey);
          return;
        }
      }
    }

    // Track failed attempt on the user
    const current = ((await this.store.get<number>(attemptsKey)) || 0) + 1;
    await this.store.set(attemptsKey, current, LOCKOUT_MS);

    if (current >= MAX_FAILED_ATTEMPTS) {
      await this.store.set(lockoutKey, true, LOCKOUT_MS);
      throw new UnauthorizedException(
        'Too many failed 2FA attempts. Account 2FA temporarily locked. Please try again later.',
      );
    }

    throw new UnauthorizedException('Invalid 2FA token');
  }

  /**
   * Regenerate backup codes for a user (requires valid TOTP token).
   */
  async regenerateBackupCodes(
    userId: string,
    token: string,
  ): Promise<{ backupCodes: string[] }> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.twoFactorSecret')
      .where('user.id = :id', { id: userId })
      .getOne();

    if (!user?.twoFactorEnabled) {
      throw new BadRequestException('2FA is not enabled');
    }

    if (
      !user.twoFactorSecret ||
      !(await this.verifyTokenOnce(userId, token, user.twoFactorSecret))
    ) {
      throw new UnauthorizedException('Invalid TOTP token');
    }

    const { plainCodes, hashedCodes } = await this.generateBackupCodes();
    await this.userRepository.update(userId, {
      twoFactorBackupCodes: hashedCodes,
    });

    return { backupCodes: plainCodes };
  }

  private async generateBackupCodes(): Promise<{
    plainCodes: string[];
    hashedCodes: string[];
  }> {
    const plainCodes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
      randomBytes(4).toString('hex').toUpperCase(),
    );
    const hashedCodes = await Promise.all(
      plainCodes.map((code) => bcrypt.hash(code, 10)),
    );
    return { plainCodes, hashedCodes };
  }
}
