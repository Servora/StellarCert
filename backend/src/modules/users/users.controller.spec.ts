import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User, UserRole, UserStatus } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UserFilterDto } from './dto/pagination.dto';
import { UpdateUserRoleDto, UpdateUserStatusDto } from './dto/admin-user.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { StorageService } from '../files/services/storage.service';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: jest.Mocked<UsersService>;

  const mockUser: Partial<User> = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    email: 'test@example.com',
    username: 'testuser',
    firstName: 'John',
    lastName: 'Doe',
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    isEmailVerified: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTokens = {
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    expiresIn: 3600,
  };

  const mockUsersService = {
    register: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    refreshTokens: jest.fn(),
    verifyEmail: jest.fn(),
    resendVerificationEmail: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    changePassword: jest.fn(),
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
    deleteProfile: jest.fn(),
    findAllUsers: jest.fn(),
    findUserById: jest.fn(),
    adminUpdateUser: jest.fn(),
    updateUserRole: jest.fn(),
    updateUserStatus: jest.fn(),
    deactivateUser: jest.fn(),
    reactivateUser: jest.fn(),
    deleteUser: jest.fn(),
    getUserStats: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        {
          provide: StorageService,
          useValue: { uploadFile: jest.fn(), deleteFile: jest.fn(), getSignedUrl: jest.fn() },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
    usersService = module.get(UsersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should declare profile stats/activity routes before the wildcard user id route', () => {
    const prototype = UsersController.prototype as unknown as Record<
      string,
      unknown
    >;
    const methodNames = Object.getOwnPropertyNames(prototype).filter(
      (name) => name !== 'constructor' && typeof prototype[name] === 'function',
    );

    const statsIndex = methodNames.indexOf('getIssuerStats');
    const activityIndex = methodNames.indexOf('getIssuerActivity');
    const wildcardIndex = methodNames.indexOf('findOne');

    expect(statsIndex).toBeGreaterThanOrEqual(0);
    expect(activityIndex).toBeGreaterThanOrEqual(0);
    expect(wildcardIndex).toBeGreaterThanOrEqual(0);
    expect(statsIndex).toBeLessThan(wildcardIndex);
    expect(activityIndex).toBeLessThan(wildcardIndex);
  });

  describe('Authentication Endpoints', () => {
    describe('register', () => {
      it('should register a new user', async () => {
        const createUserDto: CreateUserDto = {
          email: 'newuser@example.com',
          password: 'SecureP@ss123',
          firstName: 'Jane',
          lastName: 'Doe',
        };

        const expectedResult = {
          user: mockUser,
          tokens: mockTokens,
        };

        mockUsersService.register.mockResolvedValue(expectedResult);

        const result = await controller.register(createUserDto);

        expect(result).toEqual(expectedResult);
        expect(usersService.register).toHaveBeenCalledWith(createUserDto);
      });
    });

    describe('login', () => {
      it('should login a user', async () => {
        const loginDto: LoginUserDto = {
          email: 'test@example.com',
          password: 'SecureP@ss123',
        };

        const expectedResult = {
          user: mockUser,
          tokens: mockTokens,
        };

        mockUsersService.login.mockResolvedValue(expectedResult);

        const result = await controller.login(loginDto);

        expect(result).toEqual(expectedResult);
        expect(usersService.login).toHaveBeenCalledWith(loginDto);
      });
    });

    describe('logout', () => {
      it('should logout a user', async () => {
        mockUsersService.logout.mockResolvedValue(undefined);

        const result = await controller.logout(mockUser.id!);

        expect(result).toEqual({ message: 'Logged out successfully' });
        expect(usersService.logout).toHaveBeenCalledWith(mockUser.id);
      });
    });

    describe('refreshToken', () => {
      it('should refresh tokens', async () => {
        const refreshTokenDto = { refreshToken: 'valid-refresh-token' };

        mockUsersService.refreshTokens.mockResolvedValue(mockTokens);

        const result = await controller.refreshToken(refreshTokenDto);

        expect(result).toEqual(mockTokens);
        expect(usersService.refreshTokens).toHaveBeenCalledWith(
          refreshTokenDto,
        );
      });
    });
  });

  describe('Email Verification Endpoints', () => {
    describe('verifyEmail', () => {
      it('should verify email', async () => {
        const verifyEmailDto = { token: 'valid-token' };
        const expectedResult = { message: 'Email verified successfully' };

        mockUsersService.verifyEmail.mockResolvedValue(expectedResult);

        const result = await controller.verifyEmail(verifyEmailDto);

        expect(result).toEqual(expectedResult);
        expect(usersService.verifyEmail).toHaveBeenCalledWith(verifyEmailDto);
      });
    });

    describe('resendVerification', () => {
      it('should resend verification email', async () => {
        const resendDto = { email: 'test@example.com' };
        const expectedResult = {
          message: 'If the email exists, a verification link has been sent',
        };

        mockUsersService.resendVerificationEmail.mockResolvedValue(
          expectedResult,
        );

        const result = await controller.resendVerification(resendDto);

        expect(result).toEqual(expectedResult);
        expect(usersService.resendVerificationEmail).toHaveBeenCalledWith(
          resendDto,
        );
      });
    });
  });

  describe('Password Management Endpoints', () => {
    describe('forgotPassword', () => {
      it('should request password reset', async () => {
        const forgotPasswordDto = { email: 'test@example.com' };
        const expectedResult = {
          message: 'If the email exists, a password reset link has been sent',
        };

        mockUsersService.forgotPassword.mockResolvedValue(expectedResult);

        const result = await controller.forgotPassword(forgotPasswordDto);

        expect(result).toEqual(expectedResult);
        expect(usersService.forgotPassword).toHaveBeenCalledWith(
          forgotPasswordDto,
        );
      });
    });

    describe('resetPassword', () => {
      it('should reset password', async () => {
        const resetPasswordDto = {
          token: 'valid-token',
          newPassword: 'NewP@ss456',
          confirmPassword: 'NewP@ss456',
        };
        const expectedResult = { message: 'Password reset successfully' };

        mockUsersService.resetPassword.mockResolvedValue(expectedResult);

        const result = await controller.resetPassword(resetPasswordDto);

        expect(result).toEqual(expectedResult);
        expect(usersService.resetPassword).toHaveBeenCalledWith(
          resetPasswordDto,
        );
      });
    });

    describe('changePassword', () => {
      it('should change password', async () => {
        const changePasswordDto: ChangePasswordDto = {
          currentPassword: 'OldP@ss123',
          newPassword: 'NewP@ss456',
          confirmPassword: 'NewP@ss456',
        };
        const expectedResult = { message: 'Password changed successfully' };

        mockUsersService.changePassword.mockResolvedValue(expectedResult);

        const result = await controller.changePassword(
          mockUser.id!,
          changePasswordDto,
        );

        expect(result).toEqual(expectedResult);
        expect(usersService.changePassword).toHaveBeenCalledWith(
          mockUser.id,
          changePasswordDto,
        );
      });
    });
  });

  describe('Profile Management Endpoints', () => {
    describe('getProfile', () => {
      it('should get user profile', async () => {
        mockUsersService.getProfile.mockResolvedValue(mockUser as User);

        const result = await controller.getProfile(mockUser.id!);

        expect(result).toEqual(mockUser);
        expect(usersService.getProfile).toHaveBeenCalledWith(mockUser.id);
      });
    });

    describe('updateProfile', () => {
      it('should update user profile', async () => {
        const updateProfileDto: UpdateProfileDto = {
          firstName: 'Updated',
          lastName: 'Name',
        };
        const updatedUser = { ...mockUser, ...updateProfileDto };

        mockUsersService.updateProfile.mockResolvedValue(updatedUser as User);

        const result = await controller.updateProfile(
          mockUser.id!,
          updateProfileDto,
        );

        expect(result).toEqual(updatedUser);
        expect(usersService.updateProfile).toHaveBeenCalledWith(
          mockUser.id,
          updateProfileDto,
        );
      });
    });

    describe('deleteProfile', () => {
      it('should delete user profile', async () => {
        const expectedResult = { message: 'Account deactivated successfully' };

        mockUsersService.deleteProfile.mockResolvedValue(expectedResult);

        const result = await controller.deleteProfile(mockUser.id!);

        expect(result).toEqual(expectedResult);
        expect(usersService.deleteProfile).toHaveBeenCalledWith(mockUser.id);
      });
    });
  });

  describe('Admin Endpoints', () => {
    const adminId = 'admin-123';

    describe('findAll', () => {
      it('should return paginated users', async () => {
        const filterDto: UserFilterDto = { page: 1, limit: 10 };
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

        mockUsersService.findAllUsers.mockResolvedValue(paginatedResult);

        const result = await controller.findAll(filterDto);

        expect(result).toEqual(paginatedResult);
        expect(usersService.findAllUsers).toHaveBeenCalledWith(filterDto);
      });
    });

    describe('getStats', () => {
      it('should return user statistics', async () => {
        const stats = {
          total: 100,
          active: 80,
          byRole: {
            [UserRole.USER]: 70,
            [UserRole.ISSUER]: 25,
            [UserRole.ADMIN]: 5,
          },
          byStatus: {
            [UserStatus.ACTIVE]: 80,
            [UserStatus.INACTIVE]: 10,
            [UserStatus.SUSPENDED]: 5,
            [UserStatus.PENDING_VERIFICATION]: 5,
          },
          certificateIssuanceCounts: { user1: 5 },
        };

        mockUsersService.getUserStats.mockResolvedValue(stats);

        const result = await controller.getStats();

        expect(result).toEqual(stats);
        expect(usersService.getUserStats).toHaveBeenCalled();
      });
    });

    describe('findOne', () => {
      it('should return a user by ID', async () => {
        mockUsersService.findUserById.mockResolvedValue(mockUser as User);

        const result = await controller.findOne(mockUser.id!);

        expect(result).toEqual(mockUser);
        expect(usersService.findUserById).toHaveBeenCalledWith(mockUser.id);
      });
    });

    describe('adminUpdate', () => {
      it('should update a user', async () => {
        const updateDto = { firstName: 'Updated' };
        const updatedUser = { ...mockUser, ...updateDto };

        mockUsersService.adminUpdateUser.mockResolvedValue(updatedUser as User);

        const result = await controller.adminUpdate(
          adminId,
          mockUser.id!,
          updateDto,
        );

        expect(result).toEqual(updatedUser);
        expect(usersService.adminUpdateUser).toHaveBeenCalledWith(
          adminId,
          mockUser.id,
          updateDto,
        );
      });
    });

    describe('updateRole', () => {
      it('should update user role', async () => {
        const updateRoleDto: UpdateUserRoleDto = { role: UserRole.ISSUER };
        const updatedUser = { ...mockUser, role: UserRole.ISSUER };

        mockUsersService.updateUserRole.mockResolvedValue(updatedUser as User);

        const result = await controller.updateRole(
          adminId,
          mockUser.id!,
          updateRoleDto,
        );

        expect(result).toEqual(updatedUser);
        expect(usersService.updateUserRole).toHaveBeenCalledWith(
          adminId,
          mockUser.id,
          updateRoleDto,
        );
      });
    });

    describe('updateStatus', () => {
      it('should update user status', async () => {
        const updateStatusDto: UpdateUserStatusDto = {
          status: UserStatus.SUSPENDED,
        };
        const updatedUser = { ...mockUser, status: UserStatus.SUSPENDED };

        mockUsersService.updateUserStatus.mockResolvedValue(
          updatedUser as User,
        );

        const result = await controller.updateStatus(
          adminId,
          mockUser.id!,
          updateStatusDto,
        );

        expect(result).toEqual(updatedUser);
        expect(usersService.updateUserStatus).toHaveBeenCalledWith(
          adminId,
          mockUser.id,
          updateStatusDto,
        );
      });
    });

    describe('deactivate', () => {
      it('should deactivate a user', async () => {
        const deactivateDto = { reason: 'Test reason' };
        const deactivatedUser = {
          ...mockUser,
          isActive: false,
          status: UserStatus.INACTIVE,
        };

        mockUsersService.deactivateUser.mockResolvedValue(
          deactivatedUser as User,
        );

        const result = await controller.deactivate(
          adminId,
          mockUser.id!,
          deactivateDto,
        );

        expect(result).toEqual(deactivatedUser);
        expect(usersService.deactivateUser).toHaveBeenCalledWith(
          adminId,
          mockUser.id,
          deactivateDto,
        );
      });
    });

    describe('reactivate', () => {
      it('should reactivate a user', async () => {
        const reactivatedUser = {
          ...mockUser,
          isActive: true,
          status: UserStatus.ACTIVE,
        };

        mockUsersService.reactivateUser.mockResolvedValue(
          reactivatedUser as User,
        );

        const result = await controller.reactivate(adminId, mockUser.id!);

        expect(result).toEqual(reactivatedUser);
        expect(usersService.reactivateUser).toHaveBeenCalledWith(
          adminId,
          mockUser.id,
        );
      });
    });

    describe('remove', () => {
      it('should permanently delete a user', async () => {
        const expectedResult = { message: 'User deleted successfully' };

        mockUsersService.deleteUser.mockResolvedValue(expectedResult);

        const result = await controller.remove(adminId, mockUser.id!);

        expect(result).toEqual(expectedResult);
        expect(usersService.deleteUser).toHaveBeenCalledWith(
          adminId,
          mockUser.id,
        );
      });
    });
  });
});
