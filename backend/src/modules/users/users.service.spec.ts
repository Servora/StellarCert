import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { UserRepository } from './repositories/user.repository';
import { User, UserRole, UserStatus } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { EmailQueueService } from '../email/email-queue.service';
import { CertificateStatsService } from '../certificate/services/stats.service';
import { AuditService } from '../audit/services/audit.service';
import { LoggingService } from '../../common/logging/logging.service';
import { UserAuthService } from './services/user-auth.service';
import { UserProfileService } from './services/user-profile.service';
import { UserPasswordService } from './services/user-password.service';
import { UserAdminService } from './services/user-admin.service';

// Re-export real sub-services so the test module can provide them.
// They depend on the same mocked deps already provided below.

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

// Mock bcrypt
jest.mock('bcryptjs', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('UsersService', () => {
  let service: UsersService;
  let userRepository: jest.Mocked<UserRepository>;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;
  let emailQueueService: jest.Mocked<EmailQueueService>;
  let certificateStatsService: jest.Mocked<CertificateStatsService>;
  let auditService: jest.Mocked<AuditService>;

  const mockUser: User = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    email: 'test@example.com',
    username: 'testuser',
    firstName: 'John',
    lastName: 'Doe',
    password: 'hashedPassword123',
    phone: '+1234567890',
    profilePicture: null,
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    stellarPublicKey: null,
    isEmailVerified: true,
    emailVerificationToken: null,
    emailVerificationExpires: null,
    passwordResetToken: null,
    passwordResetExpires: null,
    isActive: true,
    metadata: null,
    loginAttempts: 0,
    lastLoginAt: null,
    lockedUntil: null,
    refreshToken: null,
    refreshTokenExpires: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    get fullName() {
      return `${this.firstName} ${this.lastName}`;
    },
    isLocked: jest.fn().mockReturnValue(false),
    isEmailVerificationTokenValid: jest.fn().mockReturnValue(true),
    isPasswordResetTokenValid: jest.fn().mockReturnValue(true),
  } as unknown as User;

  const mockUserRepository = {
    create: jest.fn(),
    findById: jest.fn(),
    findByIdWithPassword: jest.fn(),
    findByEmail: jest.fn(),
    findByEmailWithPassword: jest.fn(),
    findByUsername: jest.fn(),
    findByStellarPublicKey: jest.fn(),
    findByEmailVerificationToken: jest.fn(),
    findUsersWithPasswordResetTokens: jest.fn(),
    findByPasswordResetTokenHash: jest.fn(),
    findByRefreshToken: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    softDelete: jest.fn(),
    findAll: jest.fn(),
    findPaginated: jest.fn(),
    countByRole: jest.fn(),
    countByStatus: jest.fn(),
    countActive: jest.fn(),
    countTotal: jest.fn(),
    existsByEmail: jest.fn(),
    existsByUsername: jest.fn(),
    existsByStellarPublicKey: jest.fn(),
    incrementLoginAttempts: jest.fn(),
    resetLoginAttempts: jest.fn(),
    lockAccount: jest.fn(),
    updateLastLogin: jest.fn(),
    getPerUserCertificateCounts: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockEmailQueueService = {
    queueVerificationEmail: jest.fn(),
    queuePasswordReset: jest.fn(),
  };

  const mockCertificateStatsService = {
    getStatistics: jest.fn(),
  };

  const mockAuditService = {
    search: jest.fn(),
  };

  const mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        // Real sub-service classes – they will consume the mocked deps below
        UserAuthService,
        UserProfileService,
        UserPasswordService,
        UserAdminService,
        {
          provide: UserRepository,
          useValue: mockUserRepository,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: EmailQueueService,
          useValue: mockEmailQueueService,
        },
        {
          provide: CertificateStatsService,
          useValue: mockCertificateStatsService,
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
        {
          provide: LoggingService,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    userRepository = module.get(UserRepository);
    jwtService = module.get(JwtService);
    configService = module.get(ConfigService);
    emailQueueService = module.get(EmailQueueService);
    certificateStatsService = module.get(CertificateStatsService);
    auditService = module.get(AuditService);

    // Default mock implementations
    mockConfigService.get.mockReturnValue('1h');
    mockJwtService.sign.mockReturnValue('mock-jwt-token');
    mockCertificateStatsService.getStatistics.mockResolvedValue({
      totalCertificates: 0,
      activeCertificates: 0,
      revokedCertificates: 0,
      expiredCertificates: 0,
      verificationStats: {
        totalVerifications: 0,
      },
    });
    mockAuditService.search.mockResolvedValue({ data: [], total: 0 });
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword123');
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  });

  describe('register', () => {
    const createUserDto: CreateUserDto = {
      email: 'newuser@example.com',
      password: 'SecureP@ss123',
      firstName: 'Jane',
      lastName: 'Doe',
    };

    it('should successfully register a new user', async () => {
      mockUserRepository.existsByEmail.mockResolvedValue(false);
      mockUserRepository.create.mockResolvedValue({
        ...mockUser,
        ...createUserDto,
        password: 'hashedPassword123',
      });
      mockUserRepository.update.mockResolvedValue(mockUser);

      const result = await service.register(createUserDto);

      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('tokens');
      expect(result.tokens).toHaveProperty('accessToken');
      expect(result.tokens).toHaveProperty('refreshToken');
      expect(mockUserRepository.existsByEmail).toHaveBeenCalledWith(
        createUserDto.email,
      );
      expect(bcrypt.hash).toHaveBeenCalled();
      expect(emailQueueService.queueVerificationEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: createUserDto.email,
          userName: 'Jane Doe',
        }),
      );
    });

    it('should throw ConflictException if email already exists', async () => {
      mockUserRepository.existsByEmail.mockResolvedValue(true);

      await expect(service.register(createUserDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException if username already exists', async () => {
      mockUserRepository.existsByEmail.mockResolvedValue(false);
      mockUserRepository.existsByUsername.mockResolvedValue(true);

      await expect(
        service.register({ ...createUserDto, username: 'existinguser' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if Stellar public key already exists', async () => {
      mockUserRepository.existsByEmail.mockResolvedValue(false);
      mockUserRepository.existsByStellarPublicKey.mockResolvedValue(true);

      await expect(
        service.register({
          ...createUserDto,
          stellarPublicKey:
            'GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    const loginDto: LoginUserDto = {
      email: 'test@example.com',
      password: 'SecureP@ss123',
    };

    it('should successfully login a user', async () => {
      const userWithPassword = { ...mockUser, password: 'hashedPassword123' };
      mockUserRepository.findByEmailWithPassword.mockResolvedValue(
        userWithPassword,
      );
      mockUserRepository.update.mockResolvedValue(mockUser);

      const result = await service.login(loginDto);

      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('tokens');
      expect(mockUserRepository.resetLoginAttempts).toHaveBeenCalled();
      expect(mockUserRepository.updateLastLogin).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException for invalid email', async () => {
      mockUserRepository.findByEmailWithPassword.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for invalid password', async () => {
      mockUserRepository.findByEmailWithPassword.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw ForbiddenException for locked account', async () => {
      const lockedUser = {
        ...mockUser,
        isLocked: jest.fn().mockReturnValue(true),
        lockedUntil: new Date(Date.now() + 30 * 60 * 1000),
      };
      mockUserRepository.findByEmailWithPassword.mockResolvedValue(lockedUser);

      await expect(service.login(loginDto)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for deactivated account', async () => {
      const inactiveUser = { ...mockUser, isActive: false };
      mockUserRepository.findByEmailWithPassword.mockResolvedValue(
        inactiveUser,
      );

      await expect(service.login(loginDto)).rejects.toThrow(ForbiddenException);
    });

    it('should increment login attempts on failed login', async () => {
      mockUserRepository.findByEmailWithPassword.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockUserRepository.incrementLoginAttempts).toHaveBeenCalledWith(
        mockUser.id,
      );
    });

    it('should lock account after max failed attempts', async () => {
      const userWithAttempts = { ...mockUser, loginAttempts: 4 };
      mockUserRepository.findByEmailWithPassword.mockResolvedValue(
        userWithAttempts,
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(ForbiddenException);
      expect(mockUserRepository.lockAccount).toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('should successfully logout a user', async () => {
      mockUserRepository.update.mockResolvedValue(mockUser);

      await service.logout(mockUser.id);

      expect(mockUserRepository.update).toHaveBeenCalledWith(mockUser.id, {
        refreshToken: undefined,
        refreshTokenExpires: undefined,
      });
    });
  });

  describe('refreshTokens', () => {
    it('should successfully refresh tokens', async () => {
      const userWithRefreshToken = {
        ...mockUser,
        refreshToken: 'hashed-refresh-token',
        refreshTokenExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };
      mockJwtService.verify.mockReturnValue({ sub: userWithRefreshToken.id });
      mockUserRepository.findById.mockResolvedValue(userWithRefreshToken);
      mockUserRepository.update.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.refreshTokens({
        refreshToken: 'valid-refresh-token',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('should throw UnauthorizedException for invalid refresh token', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('invalid');
      });

      await expect(
        service.refreshTokens({ refreshToken: 'invalid-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for expired refresh token', async () => {
      const userWithExpiredToken = {
        ...mockUser,
        refreshToken: 'hashed-refresh-token',
        refreshTokenExpires: new Date(Date.now() - 1000),
      };
      mockJwtService.verify.mockReturnValue({ sub: userWithExpiredToken.id });
      mockUserRepository.findById.mockResolvedValue(userWithExpiredToken);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.refreshTokens({ refreshToken: 'expired-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when refresh token does not match stored hash', async () => {
      const userWithRefreshToken = {
        ...mockUser,
        refreshToken: 'hashed-refresh-token',
        refreshTokenExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };
      mockJwtService.verify.mockReturnValue({ sub: userWithRefreshToken.id });
      mockUserRepository.findById.mockResolvedValue(userWithRefreshToken);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.refreshTokens({ refreshToken: 'valid-refresh-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('verifyEmail', () => {
    it('should successfully verify email', async () => {
      const userWithToken = {
        ...mockUser,
        emailVerificationToken: 'valid-token',
        emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
        isEmailVerificationTokenValid: jest.fn().mockReturnValue(true),
      };
      mockUserRepository.findByEmailVerificationToken.mockResolvedValue(
        userWithToken,
      );
      mockUserRepository.update.mockResolvedValue(mockUser);

      const result = await service.verifyEmail({ token: 'valid-token' });

      expect(result.message).toBe('Email verified successfully');
    });

    it('should throw BadRequestException for invalid token', async () => {
      mockUserRepository.findByEmailVerificationToken.mockResolvedValue(null);

      await expect(
        service.verifyEmail({ token: 'invalid-token' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for expired token', async () => {
      const userWithExpiredToken = {
        ...mockUser,
        emailVerificationToken: 'expired-token',
        isEmailVerificationTokenValid: jest.fn().mockReturnValue(false),
      };
      mockUserRepository.findByEmailVerificationToken.mockResolvedValue(
        userWithExpiredToken,
      );

      await expect(
        service.verifyEmail({ token: 'expired-token' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resendVerificationEmail', () => {
    it('should queue a new verification email for an existing unverified user', async () => {
      const unverifiedUser = {
        ...mockUser,
        isEmailVerified: false,
      };
      mockUserRepository.findByEmail.mockResolvedValue(unverifiedUser);
      mockUserRepository.update.mockResolvedValue(unverifiedUser);

      const result = await service.resendVerificationEmail({
        email: unverifiedUser.email,
      });

      expect(result.message).toContain('If the email exists');
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        unverifiedUser.id,
        expect.objectContaining({
          emailVerificationToken: expect.any(String),
          emailVerificationExpires: expect.any(Date),
        }),
      );
      expect(emailQueueService.queueVerificationEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: unverifiedUser.email,
          userName: 'John Doe',
        }),
      );
    });
  });

  describe('changePassword', () => {
    const changePasswordDto: ChangePasswordDto = {
      currentPassword: 'OldP@ss123',
      newPassword: 'NewP@ss456',
      confirmPassword: 'NewP@ss456',
    };

    it('should successfully change password', async () => {
      mockUserRepository.findByIdWithPassword.mockResolvedValue(mockUser);
      mockUserRepository.update.mockResolvedValue(mockUser);

      const result = await service.changePassword(
        mockUser.id,
        changePasswordDto,
      );

      expect(result.message).toBe('Password changed successfully');
      expect(bcrypt.hash).toHaveBeenCalled();
    });

    it('should throw BadRequestException if passwords do not match', async () => {
      await expect(
        service.changePassword(mockUser.id, {
          ...changePasswordDto,
          confirmPassword: 'DifferentP@ss',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if user not found', async () => {
      mockUserRepository.findByIdWithPassword.mockResolvedValue(null);

      await expect(
        service.changePassword('non-existent-id', changePasswordDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw UnauthorizedException if current password is incorrect', async () => {
      mockUserRepository.findByIdWithPassword.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword(mockUser.id, changePasswordDto),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('forgotPassword', () => {
    it('should return success message regardless of email existence', async () => {
      mockUserRepository.findByEmail.mockResolvedValue(null);

      const result = await service.forgotPassword({
        email: 'nonexistent@example.com',
      });

      expect(result.message).toContain('If the email exists');
    });

    it('should generate reset token for existing user', async () => {
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.update.mockResolvedValue(mockUser);
      (bcrypt.hash as jest.Mock).mockImplementationOnce(
        async (value: string) => `hashed-${value}`,
      );

      const result = await service.forgotPassword({ email: mockUser.email });

      const queuedResetEmail =
        mockEmailQueueService.queuePasswordReset.mock.calls[0][0];
      const plainToken = queuedResetEmail.resetLink.split('token=')[1];
      const storedHash = mockUserRepository.update.mock.calls[0][1]
        .passwordResetToken as string;

      expect(result.message).toContain('If the email exists');
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({
          passwordResetToken: expect.any(String),
          passwordResetExpires: expect.any(Date),
        }),
      );
      expect(storedHash).not.toBe(plainToken);
      expect(bcrypt.hash).toHaveBeenCalledWith(plainToken, 12);
      (bcrypt.compare as jest.Mock).mockImplementationOnce(
        async (value: string, hash: string) => hash === `hashed-${value}`,
      );
      await expect(bcrypt.compare(plainToken, storedHash)).resolves.toBe(true);
      expect(emailQueueService.queuePasswordReset).toHaveBeenCalledWith(
        expect.objectContaining({
          to: mockUser.email,
          userName: 'John Doe',
          resetLink: expect.stringContaining(plainToken),
        }),
      );
    });
  });

  describe('resetPassword', () => {
    it('should successfully reset password', async () => {
      const userWithToken = {
        ...mockUser,
        passwordResetToken: 'hashed-valid-token',
        isPasswordResetTokenValid: jest.fn().mockReturnValue(true),
      };
      mockUserRepository.findByPasswordResetTokenHash.mockResolvedValue(userWithToken);
      mockUserRepository.update.mockResolvedValue(mockUser);

      const result = await service.resetPassword({
        token: 'valid-token',
        newPassword: 'NewP@ss456',
        confirmPassword: 'NewP@ss456',
      });

      expect(result.message).toBe('Password reset successfully');
      expect(mockUserRepository.findByPasswordResetTokenHash).toHaveBeenCalled();
      expect(mockUserRepository.update).toHaveBeenCalledWith(mockUser.id, {
        password: expect.any(String),
        passwordResetToken: null,
        passwordResetTokenHash: null,
        passwordResetExpires: null,
      });
    });

    it('should throw BadRequestException for invalid token', async () => {
      mockUserRepository.findByPasswordResetTokenHash.mockResolvedValue(null);

      await expect(
        service.resetPassword({
          token: 'invalid-token',
          newPassword: 'NewP@ss456',
          confirmPassword: 'NewP@ss456',
        }),
      ).rejects.toThrow('Invalid reset token');
    });

    it('should throw BadRequestException for expired matching token', async () => {
      const userWithExpiredToken = {
        ...mockUser,
        passwordResetToken: 'hashed-expired-token',
        isPasswordResetTokenValid: jest.fn().mockReturnValue(false),
      };
      mockUserRepository.findByPasswordResetTokenHash.mockResolvedValue(userWithExpiredToken);

      await expect(
        service.resetPassword({
          token: 'expired-token',
          newPassword: 'NewP@ss456',
          confirmPassword: 'NewP@ss456',
        }),
      ).rejects.toThrow('Reset token has expired');
      expect(userWithExpiredToken.isPasswordResetTokenValid).toHaveBeenCalled();
      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('getProfile', () => {
    it('should return user profile', async () => {
      mockUserRepository.findById.mockResolvedValue(mockUser);

      const result = await service.getProfile(mockUser.id);

      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException if user not found', async () => {
      mockUserRepository.findById.mockResolvedValue(null);

      await expect(service.getProfile('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateProfile', () => {
    const updateProfileDto: UpdateProfileDto = {
      firstName: 'Updated',
      lastName: 'Name',
    };

    it('should successfully update profile', async () => {
      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockUserRepository.update.mockResolvedValue({
        ...mockUser,
        ...updateProfileDto,
      });

      const result = await service.updateProfile(mockUser.id, updateProfileDto);

      expect(result.firstName).toBe('Updated');
    });

    it('should throw ConflictException if username is taken', async () => {
      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockUserRepository.existsByUsername.mockResolvedValue(true);

      await expect(
        service.updateProfile(mockUser.id, { username: 'takenusername' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('deleteProfile', () => {
    it('should soft delete user profile', async () => {
      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockUserRepository.softDelete.mockResolvedValue(mockUser);

      const result = await service.deleteProfile(mockUser.id);

      expect(result.message).toBe('Account deactivated successfully');
    });
  });

  describe('Admin Operations', () => {
    const adminId = 'admin-123';

    describe('findAllUsers', () => {
      it('should return paginated users', async () => {
        const paginatedResult = {
          data: [mockUser],
          meta: {
            total: 1,
            page: 1,
            limit: 10,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        };
        mockUserRepository.findPaginated.mockResolvedValue(paginatedResult);

        const result = await service.findAllUsers({ page: 1, limit: 10 });

        expect(result).toEqual(paginatedResult);
      });
    });

    describe('updateUserRole', () => {
      it('should update user role', async () => {
        mockUserRepository.findById.mockResolvedValue(mockUser);
        mockUserRepository.update.mockResolvedValue({
          ...mockUser,
          role: UserRole.ISSUER,
        });

        const result = await service.updateUserRole(adminId, mockUser.id, {
          role: UserRole.ISSUER,
        });

        expect(result.role).toBe(UserRole.ISSUER);
      });

      it('should throw ForbiddenException when admin tries to modify own role', async () => {
        await expect(
          service.updateUserRole(mockUser.id, mockUser.id, {
            role: UserRole.ADMIN,
          }),
        ).rejects.toThrow(ForbiddenException);
      });
    });

    describe('deactivateUser', () => {
      it('should deactivate user', async () => {
        mockUserRepository.findById.mockResolvedValue(mockUser);
        mockUserRepository.update.mockResolvedValue({
          ...mockUser,
          isActive: false,
          status: UserStatus.INACTIVE,
        });

        const result = await service.deactivateUser(adminId, mockUser.id, {
          reason: 'Test reason',
        });

        expect(result.isActive).toBe(false);
      });

      it('should throw ForbiddenException when admin tries to deactivate self', async () => {
        await expect(
          service.deactivateUser(mockUser.id, mockUser.id, {}),
        ).rejects.toThrow(ForbiddenException);
      });
    });

    describe('deleteUser', () => {
      it('should permanently delete user', async () => {
        mockUserRepository.findById.mockResolvedValue(mockUser);
        mockUserRepository.delete.mockResolvedValue(true);

        const result = await service.deleteUser(adminId, mockUser.id);

        expect(result.message).toBe('User deleted successfully');
      });

      it('should throw ForbiddenException when admin tries to delete self', async () => {
        await expect(
          service.deleteUser(mockUser.id, mockUser.id),
        ).rejects.toThrow(ForbiddenException);
      });
    });
  });

  describe('getUserStats', () => {
    it('should return user statistics', async () => {
      mockUserRepository.countTotal.mockResolvedValue(100);
      mockUserRepository.countActive.mockResolvedValue(80);
      mockUserRepository.countByRole.mockResolvedValue(50);
      mockUserRepository.countByStatus.mockResolvedValue(60);
      mockUserRepository.getPerUserCertificateCounts.mockResolvedValue({
        user1: 5,
      });

      const result = await service.getUserStats();

      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('active');
      expect(result).toHaveProperty('byRole');
      expect(result).toHaveProperty('byStatus');
      expect(result).toHaveProperty('certificateIssuanceCounts');
      expect(result.certificateIssuanceCounts).toEqual({ user1: 5 });
    });
  });
});
