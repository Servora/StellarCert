import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';

/**
 * Cryptography utility helpers
 */
export class CryptoUtils {
  /**
   * Hashes a password using bcryptjs
   * @param password - Plain text password to hash
   * @param rounds - Number of salt rounds (default: 12)
   */
  static async hashPassword(
    password: string,
    rounds: number = 12,
  ): Promise<string> {
    return bcrypt.hash(password, rounds);
  }

  /**
   * Compares a plain text password with a hashed password
   * @param password - Plain text password
   * @param hash - Hashed password to compare against
   */
  static async comparePassword(
    password: string,
    hash: string,
  ): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generates a cryptographically secure random string token
   * (useful for reset tokens, etc)
   * @param length - Length of the token (default: 32)
   */
  static generateToken(length: number = 32): string {
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < length; i++) {
      token += chars.charAt(crypto.randomInt(chars.length));
    }
    return token;
  }

  /**
   * Generates a cryptographically secure random alphanumeric code
   * using uppercase letters and digits only
   * (useful for verification codes, certificate IDs)
   * @param length - Length of the code (default: 8)
   */
  static generateAlphanumericCode(length: number = 8): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < length; i++) {
      code += chars.charAt(crypto.randomInt(chars.length));
    }
    return code;
  }

  /**
   * Generates a cryptographically secure random numeric code
   * (useful for OTP, verification codes)
   * @param length - Length of the code (default: 6)
   */
  static generateNumericCode(length: number = 6): string {
    let code = '';
    for (let i = 0; i < length; i++) {
      code += crypto.randomInt(0, 10).toString();
    }
    return code;
  }

  /**
   * Hashes data using SHA256
   */
  static sha256Hash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Creates an HMAC signature
   */
  static createHMAC(data: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }

  /**
   * Verifies an HMAC signature
   */
  static verifyHMAC(data: string, signature: string, secret: string): boolean {
    const expectedSignature = this.createHMAC(data, secret);
    return expectedSignature === signature;
  }
}
