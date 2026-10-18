import { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import request from 'supertest';
import { BullBoardAuthMiddleware } from './bull-board-auth.middleware';

const BASIC = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

const makeConfigService = (values: Record<string, string | undefined>) =>
  ({
    get: (key: string) => values[key],
  }) as unknown as ConfigService;

const makeRes = () => {
  const res: any = {
    setHeader: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
};

const makeReq = (authorization?: string): any => ({
  originalUrl: '/admin/queues',
  headers: authorization ? { authorization } : {},
});

describe('BullBoardAuthMiddleware (unit)', () => {
  describe('development without configured credentials', () => {
    it('allows the request through', () => {
      const middleware = new BullBoardAuthMiddleware(
        makeConfigService({ NODE_ENV: 'development' }),
      );
      const res = makeRes();
      const next = jest.fn();

      middleware.use(makeReq(), res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('when credentials are configured', () => {
    const configure = (overrides: Record<string, string | undefined> = {}) =>
      new BullBoardAuthMiddleware(
        makeConfigService({
          NODE_ENV: 'development',
          BULL_BOARD_ENABLED: 'true',
          BULL_BOARD_USERNAME: 'admin',
          BULL_BOARD_PASSWORD: 's3cret-password',
          ...overrides,
        }),
      );

    it('rejects a request without an Authorization header', () => {
      const res = makeRes();
      const next = jest.fn();

      configure().use(makeReq(), res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith(
        'WWW-Authenticate',
        expect.stringContaining('Basic'),
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        statusCode: 401,
        message: 'Unauthorized',
      });
    });

    it('rejects wrong credentials', () => {
      const res = makeRes();
      const next = jest.fn();

      configure().use(makeReq(BASIC('admin', 'wrong')), res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('rejects a malformed Authorization header', () => {
      const res = makeRes();
      const next = jest.fn();

      configure().use(makeReq('Bearer some-token'), res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('accepts the configured credentials', () => {
      const res = makeRes();
      const next = jest.fn();

      configure().use(makeReq(BASIC('admin', 's3cret-password')), res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('production', () => {
    it('is disabled (404) unless explicitly enabled', () => {
      const middleware = new BullBoardAuthMiddleware(
        makeConfigService({
          NODE_ENV: 'production',
          BULL_BOARD_ENABLED: 'false',
        }),
      );
      const res = makeRes();
      const next = jest.fn();

      middleware.use(makeReq(BASIC('admin', 's3cret-password')), res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('refuses access when enabled without credentials', () => {
      const middleware = new BullBoardAuthMiddleware(
        makeConfigService({
          NODE_ENV: 'production',
          BULL_BOARD_ENABLED: 'true',
        }),
      );
      const res = makeRes();
      const next = jest.fn();

      middleware.use(makeReq(), res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
});

describe('Bull Board mount at /admin/queues (integration)', () => {
  const ENV_KEYS = [
    'NODE_ENV',
    'BULL_BOARD_ENABLED',
    'BULL_BOARD_USERNAME',
    'BULL_BOARD_PASSWORD',
  ] as const;

  let app: INestApplication | undefined;
  const savedEnv: Record<string, string | undefined> = {};

  const restoreEnv = () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  };

  const bootApp = async (
    env: Partial<Record<(typeof ENV_KEYS)[number], string>>,
    options: { globalPrefix?: string } = {},
  ) => {
    for (const key of ENV_KEYS) {
      if (!(key in savedEnv)) {
        savedEnv[key] = process.env[key];
      }
      if (env[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = env[key];
      }
    }

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        BullBoardModule.forRoot({
          route: '/admin/queues',
          adapter: ExpressAdapter,
          middleware: BullBoardAuthMiddleware,
        }),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    if (options.globalPrefix) {
      app.setGlobalPrefix(options.globalPrefix);
    }
    await app.init();
    return app;
  };

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    restoreEnv();
  });

  it('rejects an unauthenticated request and accepts an authenticated one', async () => {
    const server = (
      await bootApp({
        NODE_ENV: 'development',
        BULL_BOARD_ENABLED: 'true',
        BULL_BOARD_USERNAME: 'admin',
        BULL_BOARD_PASSWORD: 's3cret-password',
      })
    ).getHttpServer();

    const unauthenticated = await request(server).get('/admin/queues');
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers['www-authenticate']).toContain('Basic');

    const wrongPassword = await request(server)
      .get('/admin/queues')
      .set('Authorization', BASIC('admin', 'nope'));
    expect(wrongPassword.status).toBe(401);

    const authenticated = await request(server)
      .get('/admin/queues')
      .set('Authorization', BASIC('admin', 's3cret-password'));
    expect(authenticated.status).toBe(200);
  });

  it('returns 404 for the dashboard in production when it is not enabled', async () => {
    const server = (
      await bootApp({
        NODE_ENV: 'production',
        BULL_BOARD_ENABLED: 'false',
        BULL_BOARD_USERNAME: 'admin',
        BULL_BOARD_PASSWORD: 's3cret-password',
      })
    ).getHttpServer();

    const response = await request(server).get('/admin/queues');
    expect(response.status).toBe(404);
  });

  it('still protects the dashboard when a global prefix is applied', async () => {
    const server = (
      await bootApp(
        {
          NODE_ENV: 'development',
          BULL_BOARD_ENABLED: 'true',
          BULL_BOARD_USERNAME: 'admin',
          BULL_BOARD_PASSWORD: 's3cret-password',
        },
        { globalPrefix: 'api' },
      )
    ).getHttpServer();

    const unauthenticated = await request(server).get('/api/admin/queues');
    expect(unauthenticated.status).toBe(401);

    const authenticated = await request(server)
      .get('/api/admin/queues')
      .set('Authorization', BASIC('admin', 's3cret-password'));
    expect(authenticated.status).toBe(200);
  });
});
