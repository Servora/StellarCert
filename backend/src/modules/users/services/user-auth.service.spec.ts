import { JwtService } from '@nestjs/jwt';
import { UserAuthService } from './user-auth.service';
import { UserRole, UserStatus } from '../entities/user.entity';

describe('UserAuthService.register token generation (#1304)', () => {
  let service: UserAuthService;
  let userRepository: any;
  let jwtService: JwtService;

  beforeEach(() => {
    userRepository = {
      existsByEmail: jest.fn().mockResolvedValue(false),
      existsByUsername: jest.fn().mockResolvedValue(false),
      existsByStellarPublicKey: jest.fn().mockResolvedValue(false),
      create: jest.fn().mockImplementation((data) =>
        Promise.resolve({
          id: 'user-1',
          email: data.email,
          role: UserRole.USER,
          status: UserStatus.PENDING_VERIFICATION,
        }),
      ),
      update: jest.fn().mockResolvedValue(undefined),
    };

    jwtService = new JwtService({ secret: 'test-secret' });

    const configService = {
      get: jest.fn((_key: string, fallback?: unknown) => fallback),
    } as any;

    service = new UserAuthService(
      userRepository,
      jwtService,
      configService,
      { queueVerificationEmail: jest.fn().mockResolvedValue(undefined) } as any,
      { log: jest.fn(), error: jest.fn(), warn: jest.fn() } as any,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
    );
  });

  it('issues access and refresh tokens that each carry their own jti', async () => {
    const { tokens } = await service.register({
      email: 'new.user@example.com',
      password: 'StrongPass123!',
      firstName: 'New',
      lastName: 'User',
    });

    const accessPayload = jwtService.decode(tokens.accessToken);
    const refreshPayload = jwtService.decode(tokens.refreshToken);

    expect(accessPayload).toHaveProperty('jti');
    expect(refreshPayload).toHaveProperty('jti');
    // Registration mints tokens through this service, not
    // JwtManagementService - without a jti on each one, every freshly
    // registered user's token would be exactly the raw-token-as-cache-key
    // case #1304 closed for login-issued tokens.
    expect(accessPayload.jti).not.toEqual(refreshPayload.jti);
  });
});
