import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

// `fs` exports are non-configurable, so `jest.spyOn(fs, 'readFileSync')` throws
// "Cannot redefine property". Mock the module instead, delegating to the real
// implementation unless a test asks reads to fail.
const mockFs = { failReads: false };
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    readFileSync: jest.fn((...args: Parameters<typeof actual.readFileSync>) => {
      if (mockFs.failReads) throw new Error('ENOENT');
      return actual.readFileSync(...args);
    }),
  };
});

function build(nodeEnv: string) {
  const config = {
    get: (key: string) => (key === 'NODE_ENV' ? nodeEnv : undefined),
  } as unknown as ConfigService;
  const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
  return { create: () => new EmailService(config, logger as never), logger };
}

describe('EmailService template loading', () => {
  afterEach(() => {
    mockFs.failReads = false;
  });

  it('loads all six templates from the source tree', () => {
    const { create } = build('test');
    const service = create();
    expect(
      (service as unknown as { templates: Map<string, unknown> }).templates
        .size,
    ).toBe(6);
  });

  it('logs and carries on outside production when a template is missing', () => {
    mockFs.failReads = true;
    const { create, logger } = build('development');

    expect(() => create()).not.toThrow();
    expect(logger.error).toHaveBeenCalled();
  });

  it('fails startup in production when a template cannot be loaded', () => {
    mockFs.failReads = true;
    const { create } = build('production');

    expect(() => create()).toThrow(/Email templates could not be loaded/);
  });
});
