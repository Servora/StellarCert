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

describe('WebhooksController test endpoint', () => {
  const subscription = { id: 's1' };
  const build = (queued: boolean) => {
    const service = {
      findOneWithSecret: jest.fn().mockResolvedValue(subscription),
      triggerEventForSubscription: jest.fn().mockResolvedValue(queued),
    };
    return new WebhooksController(service as never);
  };

  it('reports success when the test event was queued', async () => {
    await expect(build(true).test('issuer-1', 's1')).resolves.toEqual({
      message: 'Test event queued successfully',
    });
  });

  it('does not claim success when nothing was queued', async () => {
    await expect(build(false).test('issuer-1', 's1')).rejects.toThrow(
      'Could not queue the test event',
    );
  });
});

describe('WebhooksController failures endpoint (#1305)', () => {
  it('delegates to the service, scoped to the calling issuer', async () => {
    const summaries = [{ id: 's1', consecutiveFailures: 2 }];
    const service = {
      listFailing: jest.fn().mockResolvedValue(summaries),
    };
    const controller = new WebhooksController(service as never);

    await expect(controller.listFailing('issuer-1')).resolves.toBe(summaries);
    expect(service.listFailing).toHaveBeenCalledWith('issuer-1');
  });
});
