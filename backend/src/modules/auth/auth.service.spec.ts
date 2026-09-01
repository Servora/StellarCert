import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { JwtManagementService } from './services/jwt.service';
import { TwoFactorService } from './services/two-factor.service';
import { UserRepository } from '../users/repositories/user.repository';
import { RegisterDto } from './dto/register.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { CreateUserDto } from '../users/dto/create-user.dto';

describe('AuthService - Registration', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: jest.Mocked<JwtService>;

  const mockRegisterDto: RegisterDto = {
    email: 'test@example.com',
    password: 'password123',
    firstName: 'John',
    lastName: 'Doe',
  };

  const mockCreateUserDto: CreateUserDto = {
    email: 'test@example.com',
    password: 'password123',
    firstName: 'John',
    lastName: 'Doe',
  };

  const mockRegistrationResult = {
    user: {
      id: 'user-123',
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
      username: null,
      profilePicture: null,
      role: 'USER',
      stellarPublicKey: null,
      isEmailVerified: false,
      createdAt: new Date(),
    },
    tokens: {
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      expiresIn: 3600,
    },
  };

  beforeEach(async () => {
    const mockUsersService = {
      register: jest.fn(),
      findOneByEmail: jest.fn(),
      create: jest.fn(),
    } as any;

    const mockJwtService = {
      sign: jest.fn(),
      verify: jest.fn(),
    } as any;

    const mockJwtManagementService = {
      blacklistToken: jest.fn(),
      verifyRefreshToken: jest.fn(),
      refreshAccessToken: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: JwtManagementService,
          useValue: mockJwtManagementService,
        },
        {
          provide: TwoFactorService,
          useValue: {
            validateLogin: jest.fn(),
          },
        },
        {
          provide: UserRepository,
          useValue: {
            findByEmailWithPassword: jest.fn(),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
  });

  describe('register', () => {
    it('should successfully register a user by delegating to UsersService', async () => {
      usersService.register.mockResolvedValue(mockRegistrationResult as any);

      const result = await authService.register(mockRegisterDto);

      expect(usersService.register).toHaveBeenCalledWith(mockCreateUserDto);
      expect(result).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 3600,
        requiresEmailVerification: true,
        user: {
          id: 'user-123',
          email: 'test@example.com',
          firstName: 'John',
          lastName: 'Doe',
          role: 'USER',
          isEmailVerified: false,
        },
      });
    });

    it('should handle UsersService registration errors properly', async () => {
      const conflictError = new ConflictException('Email already registered');
      usersService.register.mockRejectedValue(conflictError);

      await expect(authService.register(mockRegisterDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should transform UsersService response to AuthResponseDto format', async () => {
      const registrationResult = {
        user: {
          id: 'user-456',
          email: 'jane@example.com',
          firstName: 'Jane',
          lastName: 'Smith',
          username: 'janesmith',
          profilePicture: 'profile.jpg',
          role: 'USER',
          stellarPublicKey: 'GABC...',
          isEmailVerified: true,
          createdAt: new Date('2024-01-01'),
        },
        tokens: {
          accessToken: 'access-token-456',
          refreshToken: 'refresh-token-456',
          expiresIn: 7200,
        },
      };

      usersService.register.mockResolvedValue(registrationResult as any);

      const result = await authService.register(mockRegisterDto);

      // Verify the transformation includes only the fields expected by AuthResponseDto
      expect(result).toEqual({
        accessToken: 'access-token-456',
        refreshToken: 'refresh-token-456',
        expiresIn: 7200,
        requiresEmailVerification: false,
        user: {
          id: 'user-456',
          email: 'jane@example.com',
          firstName: 'Jane',
          lastName: 'Smith',
          role: 'USER',
          isEmailVerified: true,
        },
      });

      // Ensure no unintended fields are included in the user object
      expect(result.user).not.toHaveProperty('username');
      expect(result.user).not.toHaveProperty('profilePicture');
      expect(result.user).not.toHaveProperty('stellarPublicKey');
      expect(result.user).not.toHaveProperty('createdAt');
    });

    it('should pass all required fields from RegisterDto to CreateUserDto', async () => {
      usersService.register.mockResolvedValue(mockRegistrationResult as any);

      await authService.register(mockRegisterDto);

      expect(usersService.register).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'test@example.com',
          password: 'password123',
          firstName: 'John',
          lastName: 'Doe',
        }),
      );
    });

    it('should not include optional fields in CreateUserDto when not provided', async () => {
      usersService.register.mockResolvedValue(mockRegistrationResult as any);

      await authService.register(mockRegisterDto);

      const createUserDto = usersService.register.mock.calls[0][0];
      expect(createUserDto).not.toHaveProperty('username');
      expect(createUserDto).not.toHaveProperty('phone');
      expect(createUserDto).not.toHaveProperty('stellarPublicKey');
      expect(createUserDto).not.toHaveProperty('role');
    });
  });

  describe('integration with UsersService', () => {
    it('should ensure AuthService does not duplicate user creation logic', async () => {
      // This test verifies that AuthService no longer implements its own
      // user creation logic and properly delegates to UsersService

      usersService.register.mockResolvedValue(mockRegistrationResult as any);

      await authService.register(mockRegisterDto);

      // Verify that only UsersService.register is called, not individual methods
      expect(usersService.register).toHaveBeenCalledTimes(1);
      expect(usersService.findOneByEmail).not.toHaveBeenCalled();
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('should maintain the same interface as before refactoring', async () => {
      // Ensure backward compatibility - the method signature and return type
      // should remain the same for existing clients

      usersService.register.mockResolvedValue(mockRegistrationResult as any);

      const result = await authService.register(mockRegisterDto);

      // Verify the return type structure matches AuthResponseDto
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('expiresIn');
      expect(result).toHaveProperty('user');

      expect(result.user).toHaveProperty('id');
      expect(result.user).toHaveProperty('email');
      expect(result.user).toHaveProperty('firstName');
      expect(result.user).toHaveProperty('lastName');
    });
  });
});
