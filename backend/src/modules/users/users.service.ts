import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { User, UserRole, UserStatus } from './entities/user.entity';
import { UserRepository } from './repositories/user.repository';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/change-password.dto';
import { LoginUserDto, RefreshTokenDto } from './dto/login-user.dto';
import { UserFilterDto } from './dto/pagination.dto';
import {
  AdminUpdateUserDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
  DeactivateUserDto,
} from './dto/admin-user.dto';
import {
  VerifyEmailDto,
  ResendVerificationDto,
} from './dto/email-verification.dto';
import { IPaginatedResult } from './interfaces';
import { IAuthTokens, IUserPublic } from './interfaces/user.interface';
import { CertificateStatsService } from '../certificate/services/stats.service';
import { AuditService } from '../audit/services/audit.service';
import { EmailQueueService } from '../email/email-queue.service';
import { LoggingService } from '../../common/logging/logging.service';
import { UserAuthService } from './services/user-auth.service';
import { UserProfileService } from './services/user-profile.service';
import { UserPasswordService } from './services/user-password.service';
import { UserAdminService } from './services/user-admin.service';

@Injectable()
export class UsersService {
  private readonly SALT_ROUNDS = 12;
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOCK_TIME_MINUTES = 30;
  private readonly EMAIL_VERIFICATION_EXPIRY_HOURS = 24;
  private readonly PASSWORD_RESET_EXPIRY_HOURS = 1;

  constructor(
    private readonly userRepository: UserRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly certificateStatsService: CertificateStatsService,
    private readonly auditService: AuditService,
    private readonly emailQueueService: EmailQueueService,
    private readonly logger: LoggingService,
    private readonly userAuthService: UserAuthService,
    private readonly userProfileService: UserProfileService,
    private readonly userPasswordService: UserPasswordService,
    private readonly userAdminService: UserAdminService,
  ) {}

  // ==================== Authentication Delegation ====================

  async findByEmailWithPassword(email: string): Promise<User | null> {
    return await this.userAuthService.findByEmailWithPassword(email);
  }

  async register(
    createUserDto: CreateUserDto,
  ): Promise<{ user: IUserPublic; tokens: IAuthTokens }> {
    return await this.userAuthService.register(createUserDto);
  }

  async login(
    loginDto: LoginUserDto,
  ): Promise<{ user: IUserPublic; tokens: IAuthTokens }> {
    return await this.userAuthService.login(loginDto);
  }

  async logout(userId: string): Promise<void> {
    await this.userAuthService.logout(userId);
  }

  async refreshTokens(refreshTokenDto: RefreshTokenDto): Promise<IAuthTokens> {
    return await this.userAuthService.refreshTokens(refreshTokenDto);
  }

  // ==================== Email Verification Delegation ====================

  async verifyEmail(
    verifyEmailDto: VerifyEmailDto,
  ): Promise<{ message: string }> {
    return await this.userAuthService.verifyEmail(verifyEmailDto);
  }

  async resendVerificationEmail(
    resendDto: ResendVerificationDto,
  ): Promise<{ message: string }> {
    return await this.userAuthService.resendVerificationEmail(resendDto);
  }

  // ==================== Password Management Delegation ====================

  async changePassword(
    userId: string,
    changePasswordDto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    return await this.userPasswordService.changePassword(
      userId,
      changePasswordDto,
    );
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

    const hashedPasswordResetToken = await bcrypt.hash(
      passwordResetToken,
      this.SALT_ROUNDS,
    );
    const passwordResetTokenHash =
      this.hashPasswordResetLookupToken(passwordResetToken);

    await this.userRepository.update(user.id, {
      passwordResetToken: hashedPasswordResetToken,
      passwordResetTokenHash,
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

    const passwordResetTokenHash = this.hashPasswordResetLookupToken(token);
    const user = await this.userRepository.findByPasswordResetTokenHash(
      passwordResetTokenHash,
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

  // ==================== Profile Management Delegation ====================

  async getProfile(userId: string): Promise<User> {
    return await this.userProfileService.getProfile(userId);
  }

  async updateProfile(
    userId: string,
    updateProfileDto: UpdateProfileDto,
  ): Promise<User> {
    return await this.userProfileService.updateProfile(
      userId,
      updateProfileDto,
    );
  }

  async deleteProfile(userId: string): Promise<{ message: string }> {
    return await this.userProfileService.deleteProfile(userId);
  }

  // ==================== Admin Operations Delegation ====================

  async findAllUsers(
    filterDto: UserFilterDto,
  ): Promise<IPaginatedResult<User>> {
    return await this.userAdminService.findAllUsers(filterDto);
  }

  async findUserById(id: string): Promise<User> {
    return await this.userAdminService.findUserById(id);
  }

  async adminUpdateUser(
    adminId: string,
    userId: string,
    updateDto: AdminUpdateUserDto,
  ): Promise<User> {
    return await this.userAdminService.adminUpdateUser(
      adminId,
      userId,
      updateDto,
    );
  }

  async updateUserRole(
    adminId: string,
    userId: string,
    updateRoleDto: UpdateUserRoleDto,
  ): Promise<User> {
    return await this.userAdminService.updateUserRole(
      adminId,
      userId,
      updateRoleDto,
    );
  }

  async updateUserStatus(
    adminId: string,
    userId: string,
    updateStatusDto: UpdateUserStatusDto,
  ): Promise<User> {
    return await this.userAdminService.updateUserStatus(
      adminId,
      userId,
      updateStatusDto,
    );
  }

  async deactivateUser(
    adminId: string,
    userId: string,
    deactivateDto: DeactivateUserDto,
  ): Promise<User> {
    return await this.userAdminService.deactivateUser(
      adminId,
      userId,
      deactivateDto,
    );
  }

  async reactivateUser(adminId: string, userId: string): Promise<User> {
    return await this.userAdminService.reactivateUser(adminId, userId);
  }

  async deleteUser(
    adminId: string,
    userId: string,
  ): Promise<{ message: string }> {
    return await this.userAdminService.deleteUser(adminId, userId);
  }

  // ==================== Issuer Profile Management Delegation ====================

  async getIssuerStats(userId: string): Promise<any> {
    return await this.userAdminService.getIssuerStats(userId);
  }

  async getIssuerActivity(
    userId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<any> {
    return await this.userAdminService.getIssuerActivity(userId, page, limit);
  }

  async updateIssuerProfile(userId: string, updateDto: any): Promise<any> {
    return await this.userAdminService.updateIssuerProfile(userId, updateDto);
  }

  // ==================== Statistics ====================

  async getUserStats(): Promise<{
    total: number;
    active: number;
    byRole: Record<UserRole, number>;
    byStatus: Record<UserStatus, number>;
    certificateIssuanceCounts: Record<string, number>;
  }> {
    // This method is kept in UsersService as it aggregates data from multiple services
    const [
      total,
      active,
      userCount,
      issuerCount,
      adminCount,
      recipientCount,
      verifierCount,
      auditorCount,
    ] = await Promise.all([
      this.userRepository.countTotal(),
      this.userRepository.countActive(),
      this.userRepository.countByRole(UserRole.USER),
      this.userRepository.countByRole(UserRole.ISSUER),
      this.userRepository.countByRole(UserRole.ADMIN),
      this.userRepository.countByRole(UserRole.RECIPIENT),
      this.userRepository.countByRole(UserRole.VERIFIER),
      this.userRepository.countByRole(UserRole.AUDITOR),
    ]);

    const [activeStatus, inactiveStatus, suspendedStatus, pendingStatus] =
      await Promise.all([
        this.userRepository.countByStatus(UserStatus.ACTIVE),
        this.userRepository.countByStatus(UserStatus.INACTIVE),
        this.userRepository.countByStatus(UserStatus.SUSPENDED),
        this.userRepository.countByStatus(UserStatus.PENDING_VERIFICATION),
      ]);

    const certificateIssuanceCounts =
      await this.userRepository.getPerUserCertificateCounts();

    return {
      total,
      active,
      byRole: {
        [UserRole.USER]: userCount,
        [UserRole.ISSUER]: issuerCount,
        [UserRole.ADMIN]: adminCount,
        [UserRole.RECIPIENT]: recipientCount,
        [UserRole.VERIFIER]: verifierCount,
        [UserRole.AUDITOR]: auditorCount,
      },
      byStatus: {
        [UserStatus.ACTIVE]: activeStatus,
        [UserStatus.INACTIVE]: inactiveStatus,
        [UserStatus.SUSPENDED]: suspendedStatus,
        [UserStatus.PENDING_VERIFICATION]: pendingStatus,
      },
      certificateIssuanceCounts,
    };
  }

  // ==================== Helper Methods ====================

  async findOneByEmail(email: string): Promise<User | undefined> {
    const user = await this.userRepository.findByEmail(email);
    return user || undefined;
  }

  async findOneById(id: string): Promise<User | undefined> {
    const user = await this.userRepository.findById(id);
    return user || undefined;
  }

  async create(userData: Partial<User>): Promise<User> {
    return this.userRepository.create(userData);
  }

  async update(id: string, userData: Partial<User>): Promise<User | undefined> {
    const user = await this.userRepository.update(id, userData);
    return user || undefined;
  }

  async remove(id: string): Promise<void> {
    await this.userRepository.delete(id);
  }

  // ==================== Private Methods (kept as they're used by delegated services) ====================

  private async generateTokens(user: User): Promise<IAuthTokens> {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get('JWT_EXPIRES_IN', '1h'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: '7d',
    });

    // Store refresh token
    const refreshTokenExpires = new Date();
    refreshTokenExpires.setDate(refreshTokenExpires.getDate() + 7);

    const hashedRefreshToken = await bcrypt.hash(
      refreshToken,
      this.SALT_ROUNDS,
    );

    await this.userRepository.update(user.id, {
      refreshToken: hashedRefreshToken,
      refreshTokenExpires,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 3600, // 1 hour in seconds
    };
  }

  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private hashPasswordResetLookupToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async queueVerificationEmail(
    user: User,
    emailVerificationToken: string,
  ): Promise<void> {
    try {
      await this.emailQueueService.queueVerificationEmail({
        to: user.email,
        userName: this.getUserDisplayName(user),
        verificationLink: this.buildVerificationLink(emailVerificationToken),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to queue verification email for ${user.email}: ${message}`,
      );
    }
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

  private buildVerificationLink(token: string): string {
    return this.buildAppLink('/verify-email', token);
  }

  private buildPasswordResetLink(token: string): string {
    return this.buildAppLink('/reset-password', token);
  }

  private buildAppLink(path: string, token: string): string {
    const appUrl =
      this.configService.get<string>('APP_URL') ||
      this.configService.get<string>('ALLOWED_ORIGINS')?.split(',')[0] ||
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

  private toPublicUser(user: User): IUserPublic {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      profilePicture: user.profilePicture,
      role: user.role,
      stellarPublicKey: user.stellarPublicKey,
      isEmailVerified: user.isEmailVerified,
      createdAt: user.createdAt,
    };
  }
}
