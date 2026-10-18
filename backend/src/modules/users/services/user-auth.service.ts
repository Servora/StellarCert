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
import { User, UserRole, UserStatus } from '../entities/user.entity';
import { UserRepository } from '../repositories/user.repository';
import { LoginUserDto, RefreshTokenDto } from '../dto/login-user.dto';
import { CreateUserDto } from '../dto/create-user.dto';
import {
  VerifyEmailDto,
  ResendVerificationDto,
} from '../dto/email-verification.dto';
import { IAuthTokens, IUserPublic } from '../interfaces/user.interface';
import { EmailQueueService } from '../../email/email-queue.service';
import { LoggingService } from '../../../common/logging/logging.service';
import { AuditService } from '../../audit/services/audit.service';

@Injectable()
export class UserAuthService {
  private readonly SALT_ROUNDS = 12;
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOCK_TIME_MINUTES = 30;
  private readonly EMAIL_VERIFICATION_EXPIRY_HOURS = 24;

  constructor(
    private readonly userRepository: UserRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailQueueService: EmailQueueService,
    private readonly logger: LoggingService,
    private readonly auditService: AuditService,
  ) {}

  async findByEmailWithPassword(email: string): Promise<User | null> {
    return await this.userRepository.findByEmailWithPassword(email);
  }

  async register(
    createUserDto: CreateUserDto,
  ): Promise<{ user: IUserPublic; tokens: IAuthTokens }> {
    const { email, password, stellarPublicKey, username } = createUserDto;

    // Check if email already exists
    if (await this.userRepository.existsByEmail(email)) {
      throw new ConflictException('Email already registered');
    }

    // Check if username already exists (if provided)
    if (username && (await this.userRepository.existsByUsername(username))) {
      throw new ConflictException('Username already taken');
    }

    // Check if Stellar public key already exists (if provided)
    if (
      stellarPublicKey &&
      (await this.userRepository.existsByStellarPublicKey(stellarPublicKey))
    ) {
      throw new ConflictException('Stellar public key already registered');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, this.SALT_ROUNDS);

    // Generate email verification token
    const emailVerificationToken = this.generateToken();
    const emailVerificationExpires = new Date();
    emailVerificationExpires.setHours(
      emailVerificationExpires.getHours() +
        this.EMAIL_VERIFICATION_EXPIRY_HOURS,
    );

    // Create user
    const user = await this.userRepository.create({
      ...createUserDto,
      password: hashedPassword,
      emailVerificationToken,
      emailVerificationExpires,
      status: UserStatus.PENDING_VERIFICATION,
      role: UserRole.USER,
    });

    this.logger.log(`New user registered: ${user.email}`);

    // Generate tokens
    const tokens = await this.generateTokens(user);

    await this.queueVerificationEmail(user, emailVerificationToken);

    return {
      user: this.toPublicUser(user),
      tokens,
    };
  }

  async login(
    loginDto: LoginUserDto,
  ): Promise<{ user: IUserPublic; tokens: IAuthTokens }> {
    const { email, password } = loginDto;

    // Find user with password
    const user = await this.userRepository.findByEmailWithPassword(email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if account is locked
    if (user.isLocked()) {
      const remainingTime = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / 60000,
      );
      throw new ForbiddenException(
        `Account is locked. Please try again in ${remainingTime} minutes`,
      );
    }

    // Check if account is suspended
    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('Account is suspended');
    }

    // Check if account is active
    if (!user.isActive) {
      throw new ForbiddenException('Account is deactivated');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      // Increment login attempts
      await this.userRepository.incrementLoginAttempts(user.id);

      // Check if should lock account
      if (user.loginAttempts + 1 >= this.MAX_LOGIN_ATTEMPTS) {
        const lockUntil = new Date();
        lockUntil.setMinutes(lockUntil.getMinutes() + this.LOCK_TIME_MINUTES);
        await this.userRepository.lockAccount(user.id, lockUntil);
        throw new ForbiddenException(
          `Too many failed attempts. Account locked for ${this.LOCK_TIME_MINUTES} minutes`,
        );
      }

      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset login attempts on successful login
    await this.userRepository.resetLoginAttempts(user.id);

    // Update last login
    await this.userRepository.updateLastLogin(user.id);

    // Generate tokens
    const tokens = await this.generateTokens(user);

    this.logger.log(`User logged in: ${user.email}`);

    return {
      user: this.toPublicUser(user),
      tokens,
    };
  }

  async logout(userId: string): Promise<void> {
    await this.userRepository.update(userId, {
      refreshToken: undefined,
      refreshTokenExpires: undefined,
    });
    this.logger.log(`User logged out: ${userId}`);
  }

  async refreshTokens(refreshTokenDto: RefreshTokenDto): Promise<IAuthTokens> {
    const { refreshToken } = refreshTokenDto;

    // Verify refresh token signature and extract payload
    let payload: { sub: string } | null = null;
    try {
      const decoded = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      if (!decoded || !decoded.sub || typeof decoded.sub !== 'string') {
        throw new UnauthorizedException('Invalid refresh token');
      }

      payload = { sub: decoded.sub };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const userId = payload?.sub;
    if (!userId) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Load user and validate stored refresh token hash
    const user = await this.userRepository.findById(userId);
    if (!user || !user.refreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const matches = await bcrypt.compare(refreshToken, user.refreshToken);
    if (!matches) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Check if refresh token is expired
    if (user.refreshTokenExpires && user.refreshTokenExpires < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Generate new tokens
    return this.generateTokens(user);
  }

  async verifyEmail(
    verifyEmailDto: VerifyEmailDto,
  ): Promise<{ message: string }> {
    const { token } = verifyEmailDto;

    const user = await this.userRepository.findByEmailVerificationToken(token);

    if (!user) {
      throw new BadRequestException('Invalid verification token');
    }

    if (!user.isEmailVerificationTokenValid()) {
      throw new BadRequestException('Verification token has expired');
    }

    await this.userRepository.update(user.id, {
      isEmailVerified: true,
      emailVerificationToken: undefined,
      emailVerificationExpires: undefined,
      status: UserStatus.ACTIVE,
    });

    this.logger.log(`Email verified for user: ${user.email}`);

    return { message: 'Email verified successfully' };
  }

  async resendVerificationEmail(
    resendDto: ResendVerificationDto,
  ): Promise<{ message: string }> {
    const { email } = resendDto;

    const user = await this.userRepository.findByEmail(email);

    if (!user) {
      // Don't reveal if email exists
      return {
        message: 'If the email exists, a verification link has been sent',
      };
    }

    if (user.isEmailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    // Generate new verification token
    const emailVerificationToken = this.generateToken();
    const emailVerificationExpires = new Date();
    emailVerificationExpires.setHours(
      emailVerificationExpires.getHours() +
        this.EMAIL_VERIFICATION_EXPIRY_HOURS,
    );

    await this.userRepository.update(user.id, {
      emailVerificationToken,
      emailVerificationExpires,
    });

    await this.queueVerificationEmail(user, emailVerificationToken);

    return {
      message: 'If the email exists, a verification link has been sent',
    };
  }

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

  private buildVerificationLink(token: string): string {
    return this.buildAppLink('/verify-email', token);
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
