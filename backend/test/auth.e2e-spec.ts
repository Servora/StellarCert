import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';
import { User, UserRole } from '../src/modules/users/entities/user.entity';

function extractCookie(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const cookies = headers['set-cookie'];
  if (!cookies) return undefined;
  for (const cookie of cookies) {
    const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    if (match) return decodeURIComponent(match[1]);
  }
  return undefined;
}

describe('AuthController e2e (Auth Flow Smoke Tests)', () => {
  let app: INestApplication;
  let accessToken: string;
  let refreshToken: string;
  let testUserId: string;

  const newUser = {
    email: `smoke-${Date.now()}@example.com`,
    password: 'SmokeP@ss1',
    firstName: 'Smoke',
    lastName: 'Tester',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Mirror main.ts: routes are served under /api and URI-versioned, so the
    // e2e specs must apply the same prefix and versioning or every request
    // 404s against an app whose routes are mounted at the bare path.
    // main.ts installs cookie-parser. Without it req.cookies is undefined, so
    // the refresh handler cannot read the HttpOnly refreshToken cookie and
    // every cookie-based request fails as unauthenticated.
    app.use(cookieParser());

    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user and return 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(newUser)
        .expect(201);

      expect(res.body.data).toHaveProperty('user');
      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('expiresIn');
      expect(res.body.data).not.toHaveProperty('refreshToken');
    });

    it('should set a refreshToken cookie on successful registration', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: `smoke-cookie-${Date.now()}@example.com`,
          password: 'SmokeP@ss1',
          firstName: 'SmokeCookie',
          lastName: 'Tester',
        })
        .expect(201);

      const cookie = extractCookie(res.headers, 'refreshToken');
      expect(cookie).toBeDefined();
      expect(cookie?.length).toBeGreaterThan(0);
    });

    it('should not default new registrations to the issuer role', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: `smoke-role-${Date.now()}@example.com`,
          password: 'SmokeP@ss1',
          firstName: 'SmokeRole',
          lastName: 'Tester',
        })
        .expect(201);

      expect(res.body.data.user.role).toBe(UserRole.USER);
    });

    it('should fail with duplicate email', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(newUser)
        .expect(409);
    });

    it('should fail with invalid email', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          ...newUser,
          email: 'invalid-email',
        })
        .expect(400);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login successfully and set a refreshToken cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: newUser.email,
          password: newUser.password,
        })
        .expect(200);

      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('user');
      expect(res.body.data).not.toHaveProperty('refreshToken');

      const cookie = extractCookie(res.headers, 'refreshToken');
      expect(cookie).toBeDefined();
      expect(cookie?.length).toBeGreaterThan(0);

      accessToken = res.body.data.accessToken;
      refreshToken = cookie!;
    });

    it('should fail with invalid credentials', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: newUser.email, password: 'WrongP@ss1' })
        .expect(401);
    });

    it('should fail with non-existent email', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nonexistent@smoke.com', password: 'SomeP@ss1' })
        .expect(401);
    });

    it('should store the refreshToken for use in subsequent steps', () => {
      expect(refreshToken).toBeDefined();
      expect(refreshToken.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('should refresh tokens using the refreshToken cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refreshToken=${refreshToken}`])
        .expect(200);

      expect(res.body.data).toHaveProperty('accessToken');
      // The rotated refresh token is delivered only as an HttpOnly cookie.
      // Returning it in the body too would hand it to any script on the page,
      // which is exactly what the cookie is there to prevent - so assert it is
      // absent, and check the cookie below.
      expect(res.body.data).not.toHaveProperty('refreshToken');

      const newCookie = extractCookie(res.headers, 'refreshToken');
      expect(newCookie).toBeDefined();
    });

    it('should fail with an invalid refresh token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', ['refreshToken=invalid-token'])
        .expect(401);
    });

    it('should fail when no refresh token cookie is provided', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .expect(401);
    });
  });

  describe('Authenticated read via GET /api/v1/certificates/stats', () => {
    // GET /certificates/stats is restricted to ADMIN, ISSUER and AUDITOR -
    // detailed statistics are not something a plain account should read, and
    // registration deliberately only ever grants `user`. So promote the smoke
    // user directly in the database and sign in again to pick up a token that
    // carries the new role.
    beforeAll(async () => {
      const dataSource = app.get(DataSource);
      await dataSource
        .getRepository(User)
        .update({ email: newUser.email }, { role: UserRole.ISSUER });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: newUser.email, password: newUser.password })
        .expect(200);
      accessToken = res.body.data.accessToken;
    });

    it('should return statistics for a user with a reporting role', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/certificates/stats')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data).toBeDefined();
        });
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/certificates/stats')
        .expect(401);
    });
  });
});
