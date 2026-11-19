import {
  Injectable,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { User, UserRole, UserStatus } from '../entities/user.entity';
import { UserRepository } from '../repositories/user.repository';
import { CreateUserDto } from '../dto/create-user.dto';
import {
  VerifyEmailDto,
  ResendVerificationDto,
} from '../dto/email-verification.dto';
import { IAuthTokens, IUserPublic } from '../interfaces/user.interface';
import { EmailQueueService } from '../../email/email-queue.service';
import { LoggingService } from '../../../common/logging/logging.service';
import { AuditService } from '../../audit/services/audit.service';
import { tokenLifetimeSeconds } from '../../auth/utils/token-lifetime';
import { buildAppLink as buildTokenLink } from '../../../config/public-url.config';

@Injectable()
export class UserAuthService {
  private readonly SALT_ROUNDS = 12;
  private readonly EMAIL_VERIFICATION_EXPIRY_HOURS = 24;

  constructor(
    private readonly userRepository: UserRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailQueueService: EmailQueueService,
    private readonly logger: LoggingService,
    private readonly auditService: AuditService,
  ) {}

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

    // Issue #1109: these two must be `null`, not `undefined`. TypeORM's
    // update() skips any field whose value is `undefined`, so the previous
    // version wrote only `isEmailVerified` and `status` and left the token in
    // the row - a verified account could be verified again by re-posting the
    // same token, and the token stayed readable for the lifetime of the account.
    //
    // The assertion is confined to these two columns. Both are declared
    // `string` / `Date` rather than `| null` on the entity, unlike the adjacent
    // `refreshToken` and `twoFactorSecret`, which is why `null` does not type
    // check. Widening both column types to `| null` is the correct follow-up;
    // it is a separate change because it reaches every reader of these fields.
    const verifiedUpdate: Partial<User> = {
      isEmailVerified: true,
      status: UserStatus.ACTIVE,
      emailVerificationToken: null as unknown as string,
      emailVerificationExpires: null as unknown as Date,
    };

    await this.userRepository.update(user.id, verifiedUpdate);

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
      expiresIn: this.configService.get('JWT_ACCESS_EXPIRES_IN', '15m'),
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
      expiresIn: tokenLifetimeSeconds(accessToken),
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
    return buildTokenLink(path, token);
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
