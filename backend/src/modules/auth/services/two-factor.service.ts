import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { authenticator } from 'otplib';
import * as qrcode from 'qrcode';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';

const BACKUP_CODE_COUNT = 8;

@Injectable()
export class TwoFactorService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

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
      !this.verifyToken(token, user.twoFactorSecret)
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
    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.twoFactorSecret')
      .addSelect('user.twoFactorBackupCodes')
      .where('user.id = :id', { id: userId })
      .getOne();

    if (!user?.twoFactorSecret) {
      throw new UnauthorizedException('2FA not configured');
    }

    // Try TOTP first
    if (this.verifyToken(token, user.twoFactorSecret)) {
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
          return;
        }
      }
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
      !this.verifyToken(token, user.twoFactorSecret)
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
