import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { UserRepository } from '../users/repositories/user.repository';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LogoutDto } from './dto/logout.dto';
import { LogoutResponseDto } from './dto/logout-response.dto';
import { JwtManagementService } from './services/jwt.service';
import { TwoFactorService } from './services/two-factor.service';
import { UserStatus } from '../users/entities/user.entity';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly jwtManagementService: JwtManagementService,
    private readonly twoFactorService: TwoFactorService,
    private readonly userRepository: UserRepository,
  ) {}

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findOneByEmail(email);
    if (user) {
      // Need to get user with password for comparison
      const userWithPassword =
        await this.userRepository.findByEmailWithPassword(email);
      if (
        userWithPassword &&
        (await bcrypt.compare(pass, userWithPassword.password))
      ) {
        const { password, ...result } = userWithPassword;
        return result;
      }
    }
    return null;
  }

  async login(
    loginDto: LoginDto,
  ): Promise<
    AuthResponseDto & { requires2FA?: boolean; preAuthToken?: string }
  > {
    const user = await this.validateUser(loginDto.email, loginDto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('Account is suspended');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Account is deactivated');
    }

    // If 2FA is enabled, issue a short-lived pre-auth token instead of a full access token
    if (user.twoFactorEnabled) {
      const preAuthToken = this.jwtService.sign(
        { sub: user.id, type: 'pre-auth' },
        { expiresIn: '5m' },
      );
      return { requires2FA: true, preAuthToken } as any;
    }

    const payload = { email: user.email, sub: user.id, role: user.role };
    const accessToken =
      await this.jwtManagementService.generateAccessToken(payload);
    const refreshToken =
      await this.jwtManagementService.generateRefreshToken(payload);

    // Update the refresh token in the database
    const hashedRefreshToken = await bcrypt.hash(refreshToken, 12);
    await this.userRepository.update(user.id, {
      refreshToken: hashedRefreshToken,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 3600,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isEmailVerified: user.isEmailVerified ?? user.emailVerified ?? false,
      },
    };
  }

  async verifyTwoFactor(
    preAuthToken: string,
    token: string,
  ): Promise<AuthResponseDto> {
    let payload: any;
    try {
      payload = this.jwtService.verify(preAuthToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired pre-auth token');
    }

    if (payload.type !== 'pre-auth') {
      throw new UnauthorizedException('Invalid token type');
    }

    await this.twoFactorService.validateLogin(payload.sub, token);

    const user = await this.usersService.findOneById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const payloadForToken = {
      email: user.email,
      sub: user.id,
      role: user.role,
    };
    const accessToken =
      await this.jwtManagementService.generateAccessToken(payloadForToken);
    const refreshToken =
      await this.jwtManagementService.generateRefreshToken(payloadForToken);

    // Update the refresh token in the database
    const hashedRefreshToken = await bcrypt.hash(refreshToken, 12);
    await this.userRepository.update(user.id, {
      refreshToken: hashedRefreshToken,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 3600,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isEmailVerified: user.isEmailVerified ?? false,
      },
    };
  }

  async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
    // Delegate to UsersService for proper registration logic
    const registrationResult = await this.usersService.register({
      email: registerDto.email,
      password: registerDto.password,
      firstName: registerDto.firstName,
      lastName: registerDto.lastName,
    });

    const { user, tokens } = registrationResult;

    // Return in the format expected by AuthResponseDto
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      requiresEmailVerification: !user.isEmailVerified,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isEmailVerified: user.isEmailVerified ?? false,
      },
    };
  }

  async logout(user: any, logoutDto: LogoutDto): Promise<LogoutResponseDto> {
    // Blacklist access token
    if (logoutDto.accessToken) {
      await this.jwtManagementService.blacklistToken(logoutDto.accessToken);
    }

    // Optionally invalidate refresh token stored in database
    await this.userRepository.update(user.id, {
      refreshToken: undefined,
    });

    return {
      message: 'Successfully logged out',
      success: true,
    };
  }

  async refreshTokens(refreshToken: string): Promise<AuthResponseDto> {
    try {
      // Verify the refresh token
      const payload =
        await this.jwtManagementService.verifyRefreshToken(refreshToken);

      // Check if user still exists and is active
      const user = await this.usersService.findOneById(payload.sub);
      if (!user || !user.isActive) {
        throw new UnauthorizedException('User not found or inactive');
      }

      // Verify that the refresh token in the DB matches the one provided
      if (!user.refreshToken) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const matches = await bcrypt.compare(refreshToken, user.refreshToken);
      if (!matches) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Generate new tokens
      const tokens =
        await this.jwtManagementService.refreshAccessToken(refreshToken);

      // Update the refresh token in the database
      const hashedRefreshToken = await bcrypt.hash(tokens.refreshToken, 12);
      await this.userRepository.update(user.id, {
        refreshToken: hashedRefreshToken,
      });

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: 3600,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isEmailVerified: user.isEmailVerified ?? false,
        },
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }
}
