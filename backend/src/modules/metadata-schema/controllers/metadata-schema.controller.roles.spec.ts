import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles';
import { MetadataSchemaController } from './metadata-schema.controller';

const WRITE_HANDLERS = ['create', 'update', 'upgrade', 'deactivate'] as const;
const READ_HANDLERS = [
  'findAll',
  'findOne',
  'findByName',
  'findLatest',
  'getVersionHistory',
  'validate',
] as const;

describe('MetadataSchemaController access', () => {
  it('keeps JWT authentication and the role check on the controller', () => {
    const guards: unknown[] = Reflect.getMetadata(
      GUARDS_METADATA,
      MetadataSchemaController,
    );

    expect(guards.map((guard) => (guard as { name: string }).name)).toEqual([
      'JwtAuthGuard',
      'RolesGuard',
    ]);
  });

  it.each(WRITE_HANDLERS)('restricts %s to issuers and admins', (handler) => {
    const roles: UserRole[] = Reflect.getMetadata(
      ROLES_KEY,
      MetadataSchemaController.prototype[handler],
    );

    expect(roles).toEqual(
      expect.arrayContaining([UserRole.ISSUER, UserRole.ADMIN]),
    );
    expect(roles).not.toContain(UserRole.USER);
    expect(roles).not.toContain(UserRole.RECIPIENT);
    expect(roles).not.toContain(UserRole.VERIFIER);
    expect(roles).not.toContain(UserRole.AUDITOR);
  });

  it.each(READ_HANDLERS)(
    'leaves %s readable by any authenticated user',
    (handler) => {
      const roles = Reflect.getMetadata(
        ROLES_KEY,
        MetadataSchemaController.prototype[handler],
      );

      expect(roles).toBeUndefined();
    },
  );
});
