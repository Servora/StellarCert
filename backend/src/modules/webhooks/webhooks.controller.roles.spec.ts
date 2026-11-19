import 'reflect-metadata';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles';
import { WebhooksController } from './webhooks.controller';

describe('WebhooksController access', () => {
  it('is limited to issuers and admins', () => {
    const roles: UserRole[] = Reflect.getMetadata(
      ROLES_KEY,
      WebhooksController,
    );

    expect(roles).toEqual(
      expect.arrayContaining([UserRole.ISSUER, UserRole.ADMIN]),
    );
    expect(roles).not.toContain(UserRole.USER);
    expect(roles).not.toContain(UserRole.RECIPIENT);
    expect(roles).not.toContain(UserRole.VERIFIER);
  });

  it('keeps JWT authentication in front of the role check', () => {
    const guards: unknown[] = Reflect.getMetadata(
      '__guards__',
      WebhooksController,
    );
    expect(guards.map((guard) => (guard as { name: string }).name)).toEqual([
      'JwtAuthGuard',
      'RolesGuard',
    ]);
  });
});
