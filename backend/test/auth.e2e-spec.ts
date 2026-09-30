import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UserRole } from '../src/modules/users/entities/user.entity';

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

      expect(res.body).toHaveProperty('user');
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('expiresIn');
      expect(res.body).not.toHaveProperty('refreshToken');
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

      expect(res.body.user.role).toBe(UserRole.USER);
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

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('user');
      expect(res.body).not.toHaveProperty('refreshToken');

      const cookie = extractCookie(res.headers, 'refreshToken');
      expect(cookie).toBeDefined();
      expect(cookie?.length).toBeGreaterThan(0);

      accessToken = res.body.accessToken;
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

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');

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
    it('should return statistics for an authenticated user', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/certificates/stats')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toBeDefined();
        });
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/certificates/stats')
        .expect(401);
    });
  });
});
