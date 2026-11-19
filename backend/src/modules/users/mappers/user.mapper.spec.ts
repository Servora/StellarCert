import { User, UserRole, UserStatus } from '../entities/user.entity';
import { toAdminUserResponse, toPublicUser } from './user.mapper';

const SECRET_KEYS = [
  'password',
  'emailVerificationToken',
  'emailVerificationExpires',
  'passwordResetToken',
  'passwordResetTokenHash',
  'passwordResetExpires',
  'refreshToken',
  'refreshTokenExpires',
  'tokenVersion',
  'twoFactorSecret',
  'twoFactorBackupCodes',
];

function makeUser(): User {
  return {
    id: 'user-1',
    email: 'a+x@example.com',
    username: 'alice',
    firstName: 'Alice',
    lastName: 'Example',
    phone: '+2348000000000',
    profilePicture: 'https://example.com/a.png',
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    stellarPublicKey: 'GABC',
    isEmailVerified: true,
    isActive: true,
    lastLoginAt: new Date('2026-10-20T00:00:00Z'),
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-20T00:00:00Z'),
    emailVerificationToken: 'verify-secret',
    passwordResetToken: 'reset-hash',
    passwordResetTokenHash: 'lookup-hash',
    refreshToken: 'refresh-hash',
    tokenVersion: 3,
  } as User;
}

describe('user mappers (#1238)', () => {
  it('public mapper returns only profile fields', () => {
    const mapped = toPublicUser(makeUser());

    expect(mapped).toEqual({
      id: 'user-1',
      email: 'a+x@example.com',
      username: 'alice',
      firstName: 'Alice',
      lastName: 'Example',
      profilePicture: 'https://example.com/a.png',
      role: UserRole.USER,
      stellarPublicKey: 'GABC',
      isEmailVerified: true,
      createdAt: new Date('2026-10-01T00:00:00Z'),
    });
    SECRET_KEYS.forEach((key) => expect(mapped).not.toHaveProperty(key));
  });

  it('admin mapper keeps operational fields but drops credentials', () => {
    const mapped = toAdminUserResponse(makeUser());

    expect(mapped).toMatchObject({
      id: 'user-1',
      status: UserStatus.ACTIVE,
      isActive: true,
      phone: '+2348000000000',
      lastLoginAt: new Date('2026-10-20T00:00:00Z'),
    });
    SECRET_KEYS.forEach((key) => expect(mapped).not.toHaveProperty(key));
  });
});
