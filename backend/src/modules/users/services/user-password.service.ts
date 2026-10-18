import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { User } from '../entities/user.entity';
import { UserRepository } from '../repositories/user.repository';
import * as bcrypt from 'bcryptjs';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from '../dto/change-password.dto';
import { EmailQueueService } from '../../email/email-queue.service';
import { LoggingService } from '../../../common/logging/logging.service';
import * as crypto from 'crypto';

@Injectable()
export class UserPasswordService {
  private readonly SALT_ROUNDS = 12;
  private readonly PASSWORD_RESET_EXPIRY_HOURS = 1;

  constructor(
    private readonly userRepository: UserRepository,
    private readonly emailQueueService: EmailQueueService,
    private readonly logger: LoggingService,
  ) {}

  async changePassword(
    userId: string,
    changePasswordDto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const { currentPassword, newPassword, confirmPassword } = changePasswordDto;

    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const user = await this.userRepository.findByIdWithPassword(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, this.SALT_ROUNDS);

    await this.userRepository.update(userId, { password: hashedPassword });

    this.logger.log(`Password changed for user: ${user.email}`);

    return { message: 'Password changed successfully' };
  }

  async forgotPassword(
    forgotPasswordDto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    const { email } = forgotPasswordDto;

    const user = await this.userRepository.findByEmail(email);

    if (!user) {
      // Don't reveal if email exists
      return {
        message: 'If the email exists, a password reset link has been sent',
      };
    }

    // Generate password reset token
    const passwordResetToken = this.generateToken();
    const passwordResetExpires = new Date();
    passwordResetExpires.setHours(
      passwordResetExpires.getHours() + this.PASSWORD_RESET_EXPIRY_HOURS,
    );

    await this.userRepository.update(user.id, {
      passwordResetToken: await bcrypt.hash(
        passwordResetToken,
        this.SALT_ROUNDS,
      ),
      passwordResetTokenHash:
        this.hashPasswordResetLookupToken(passwordResetToken),
      passwordResetExpires,
    });

    await this.queuePasswordResetEmail(user, passwordResetToken);

    this.logger.log(`Password reset requested for: ${email}`);

    return {
      message: 'If the email exists, a password reset link has been sent',
    };
  }

  async resetPassword(
    resetPasswordDto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    const { token, newPassword, confirmPassword } = resetPasswordDto;

    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const user = await this.userRepository.findByPasswordResetTokenHash(
      this.hashPasswordResetLookupToken(token),
    );

    if (!user) {
      throw new BadRequestException('Invalid reset token');
    }

    if (!user.isPasswordResetTokenValid()) {
      throw new BadRequestException('Reset token has expired');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, this.SALT_ROUNDS);

    await this.userRepository.update(user.id, {
      password: hashedPassword,
      passwordResetToken: null as any,
      passwordResetTokenHash: null as any,
      passwordResetExpires: null as any,
    });

    this.logger.log(`Password reset completed for: ${user.email}`);

    return { message: 'Password reset successfully' };
  }

  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private hashPasswordResetLookupToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async queuePasswordResetEmail(
    user: User,
    passwordResetToken: string,
  ): Promise<void> {
    try {
      await this.emailQueueService.queuePasswordReset({
        to: user.email,
        userName: this.getUserDisplayName(user),
        resetLink: this.buildPasswordResetLink(passwordResetToken),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to queue password reset email for ${user.email}: ${message}`,
      );
    }
  }

  private buildPasswordResetLink(token: string): string {
    return this.buildAppLink('/reset-password', token);
  }

  private buildAppLink(path: string, token: string): string {
    const appUrl =
      process.env.APP_URL ||
      process.env.ALLOWED_ORIGINS?.split(',')[0] ||
      'http://localhost:5173';

    const normalizedBaseUrl = appUrl.replace(/\/+$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    return `${normalizedBaseUrl}${normalizedPath}?token=${encodeURIComponent(token)}`;
  }

  private getUserDisplayName(user: User): string {
    return (
      `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email
    );
  }
}
