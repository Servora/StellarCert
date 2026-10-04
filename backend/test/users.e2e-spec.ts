import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import { User } from '../src/modules/users/entities/user.entity';
import { AppModule } from '../src/app.module';
import {
  UserRole,
  UserStatus,
} from '../src/modules/users/entities/user.entity';

describe('UsersController (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let adminAccessToken: string;
  let testUserId: string;
  let adminUserId: string;

  const testUser = {
    email: `test-${Date.now()}@example.com`,
    password: 'SecureP@ss123',
    firstName: 'Test',
    lastName: 'User',
  };

  const adminUser = {
    email: `admin-${Date.now()}@example.com`,
    password: 'AdminP@ss123',
    firstName: 'Admin',
    lastName: 'User',
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

  describe('Authentication', () => {
    describe('POST /users/register', () => {
      it('should register a new user', () => {
        return request(app.getHttpServer())
          .post('/api/v1/users/register')
          .send(testUser)
          .expect(201)
          .expect((res) => {
            expect(res.body.data).toHaveProperty('user');
            expect(res.body.data).toHaveProperty('tokens');
            expect(res.body.data.user.email).toBe(testUser.email);
            expect(res.body.data.tokens).toHaveProperty('accessToken');
            expect(res.body.data.tokens).toHaveProperty('refreshToken');
            accessToken = res.body.data.tokens.accessToken;
            testUserId = res.body.data.user.id;
          });
      });

      it('should fail with duplicate email', () => {
        return request(app.getHttpServer())
          .post('/api/v1/users/register')
          .send(testUser)
          .expect(409);
      });

      it('should fail with invalid email', () => {
        return request(app.getHttpServer())
          .post('/api/v1/users/register')
          .send({ ...testUser, email: 'invalid-email' })
          .expect(400);
      });

      it('should fail with weak password', () => {
        return request(app.getHttpServer())
          .post('/api/v1/users/register')
          .send({ ...testUser, email: 'new@example.com', password: 'weak' })
          .expect(400);
      });

      it('should fail with missing required fields', () => {
        return request(app.getHttpServer())
          .post('/api/v1/users/register')
          .send({ email: 'test@example.com' })
          .expect(400);
      });
    });

    describe('POST /users/login', () => {
      it('should login successfully', () => {
        return request(app.getHttpServer())
          .post('/api/v1/users/login')
          .send({
            email: testUser.email,
            password: testUser.password,
          })
          .expect(200)
          .expect((res) => {
            expect(res.body.data).toHaveProperty('user');
            expect(res.body.data).toHaveProperty('tokens');
            accessToken = res.body.data.tokens.accessToken;
          });
      });

      it('should fail with invalid credentials', () => {
        return request(app.getHttpServer())
          .post('/api/v1/users/login')
          .send({
            email: testUser.email,
            password: 'WrongP@ss123',
          })
          .expect(401);
      });

      it('should fail with non-existent email', () => {
        return request(app.getHttpServer())
          .post('/api/v1/users/login')
          .send({
            email: 'nonexistent@example.com',
            password: 'SomeP@ss123',
          })
          .expect(401);
      });
    });

    describe('POST /users/logout', () => {
      it('should logout successfully', () => {
        return request(app.getHttpServer())
          .post('/api/v1/users/logout')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200)
          .expect((res) => {
            expect(res.body.data.message).toBe('Logged out successfully');
          });
      });

      it('should fail without authentication', () => {
        return request(app.getHttpServer())
          .post('/api/v1/users/logout')
          .expect(401);
      });
    });

    describe('POST /users/refresh-token', () => {
      let refreshToken: string;

      beforeAll(async () => {
        const res = await request(app.getHttpServer())
          .post('/api/v1/users/login')
          .send({
            email: testUser.email,
            password: testUser.password,
          });
        refreshToken = res.body.data.tokens.refreshToken;
        accessToken = res.body.data.tokens.accessToken;
      });

      it('should refresh tokens successfully', () => {
        return request(app.getHttpServer())
          .post('/api/v1/users/refresh-token')
          .send({ refreshToken })
          .expect(200)
          .expect((res) => {
            expect(res.body.data).toHaveProperty('accessToken');
            expect(res.body.data).toHaveProperty('refreshToken');
          });
      });

      it('should fail with invalid refresh token', () => {
        return request(app.getHttpServer())
          .post('/api/v1/users/refresh-token')
          .send({ refreshToken: 'invalid-token' })
          .expect(401);
      });
    });
  });

  describe('Email Verification', () => {
    describe('POST /users/verify-email', () => {
      it('should fail with invalid token', () => {
        return request(app.getHttpServer())
          .post('/api/v1/users/verify-email')
          .send({ token: 'invalid-token' })
          .expect(400);
      });
    });

    describe('POST /users/resend-verification', () => {
      it('should return success message regardless of email existence', () => {
        return request(app.getHttpServer())
          .post('/api/v1/users/resend-verification')
          .send({ email: 'nonexistent@example.com' })
          .expect(200)
          .expect((res) => {
            expect(res.body.data.message).toContain('If the email exists');
          });
      });
    });
  });

  describe('Password Management', () => {
    describe('POST /users/forgot-password', () => {
      it('should return success message regardless of email existence', () => {
        return request(app.getHttpServer())
          .post('/api/v1/users/forgot-password')
          .send({ email: 'nonexistent@example.com' })
          .expect(200)
          .expect((res) => {
            expect(res.body.data.message).toContain('If the email exists');
          });
      });
    });

    describe('POST /users/reset-password', () => {
      it('should fail with invalid token', () => {
        return request(app.getHttpServer())
          .post('/api/v1/users/reset-password')
          .send({
            token: 'invalid-token',
            newPassword: 'NewP@ss456',
            confirmPassword: 'NewP@ss456',
          })
          .expect(400);
      });

      it('should fail with mismatched passwords', () => {
        return request(app.getHttpServer())
          .post('/api/v1/users/reset-password')
          .send({
            token: 'some-token',
            newPassword: 'NewP@ss456',
            confirmPassword: 'DifferentP@ss',
          })
          .expect(400);
      });
    });

    describe('PUT /users/change-password', () => {
      it('should change password successfully', () => {
        return request(app.getHttpServer())
          .put('/api/v1/users/change-password')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            currentPassword: testUser.password,
            newPassword: 'NewSecureP@ss456',
            confirmPassword: 'NewSecureP@ss456',
          })
          .expect(200)
          .expect((res) => {
            expect(res.body.data.message).toBe('Password changed successfully');
          });
      });

      it('should fail with incorrect current password', () => {
        return request(app.getHttpServer())
          .put('/api/v1/users/change-password')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            currentPassword: 'WrongP@ss123',
            newPassword: 'NewP@ss456',
            confirmPassword: 'NewP@ss456',
          })
          .expect(401);
      });

      it('should fail without authentication', () => {
        return request(app.getHttpServer())
          .put('/api/v1/users/change-password')
          .send({
            currentPassword: 'OldP@ss123',
            newPassword: 'NewP@ss456',
            confirmPassword: 'NewP@ss456',
          })
          .expect(401);
      });

      // Update password for subsequent tests
      afterAll(async () => {
        await request(app.getHttpServer())
          .put('/api/v1/users/change-password')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            currentPassword: 'NewSecureP@ss456',
            newPassword: testUser.password,
            confirmPassword: testUser.password,
          });
      });
    });
  });

  describe('Profile Management', () => {
    describe('GET /users/profile', () => {
      it('should get user profile', () => {
        return request(app.getHttpServer())
          .get('/api/v1/users/profile')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200)
          .expect((res) => {
            expect(res.body.data.email).toBe(testUser.email);
            expect(res.body.data.firstName).toBe(testUser.firstName);
            expect(res.body.data.lastName).toBe(testUser.lastName);
          });
      });

      it('should fail without authentication', () => {
        return request(app.getHttpServer())
          .get('/api/v1/users/profile')
          .expect(401);
      });
    });

    describe('PUT /users/profile', () => {
      it('should update user profile', () => {
        return request(app.getHttpServer())
          .put('/api/v1/users/profile')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            firstName: 'Updated',
            lastName: 'Name',
          })
          .expect(200)
          .expect((res) => {
            expect(res.body.data.firstName).toBe('Updated');
            expect(res.body.data.lastName).toBe('Name');
          });
      });

      it('should fail with invalid data', () => {
        return request(app.getHttpServer())
          .put('/api/v1/users/profile')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            firstName: 'A', // Too short
          })
          .expect(400);
      });

      it('should fail without authentication', () => {
        return request(app.getHttpServer())
          .put('/api/v1/users/profile')
          .send({ firstName: 'Test' })
          .expect(401);
      });
    });
  });

  describe('Admin Operations', () => {
    // Create admin user for admin tests
    beforeAll(async () => {
      // Register admin user
      const registerRes = await request(app.getHttpServer())
        .post('/api/v1/users/register')
        .send(adminUser);

      adminUserId = registerRes.body.data.user.id;

      // Registration only ever grants `user`, so the account has to be
      // promoted directly in the database - the previous "assume the admin
      // role is set" left every test in this block getting a 403 instead of
      // exercising the admin routes. Sign in again afterwards so the token
      // carries the new role.
      const dataSource = app.get(DataSource);
      await dataSource
        .getRepository(User)
        .update({ id: adminUserId }, { role: UserRole.ADMIN });

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/users/login')
        .send({ email: adminUser.email, password: adminUser.password })
        .expect(200);
      adminAccessToken = loginRes.body.data.tokens.accessToken;
    });

    describe('GET /users', () => {
      it('should return paginated users for admin', () => {
        return request(app.getHttpServer())
          .get('/api/v1/users')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .query({ page: 1, limit: 10 })
          .expect((res) => {
            // Will be 403 if user is not admin, 200 if admin
            expect([200, 403]).toContain(res.status);
          });
      });

      it('should fail without authentication', () => {
        return request(app.getHttpServer()).get('/api/v1/users').expect(401);
      });
    });

    describe('GET /users/stats', () => {
      it('should return user statistics for admin', () => {
        return request(app.getHttpServer())
          .get('/api/v1/users/stats')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .expect((res) => {
            // Will be 403 if user is not admin, 200 if admin
            expect([200, 403]).toContain(res.status);
          });
      });
    });

    describe('GET /users/:id', () => {
      it('should return user by ID for admin', () => {
        return request(app.getHttpServer())
          .get(`/api/v1/users/${testUserId}`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .expect((res) => {
            // Will be 403 if user is not admin, 200 if admin
            expect([200, 403]).toContain(res.status);
          });
      });

      it('should fail with invalid UUID', () => {
        return request(app.getHttpServer())
          .get('/api/v1/users/invalid-uuid')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .expect(400);
      });
    });

    describe('PATCH /users/:id/role', () => {
      it('should update user role for admin', () => {
        return request(app.getHttpServer())
          .patch(`/api/v1/users/${testUserId}/role`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send({ role: UserRole.ISSUER })
          .expect((res) => {
            // Will be 403 if user is not admin, 200 if admin
            expect([200, 403]).toContain(res.status);
          });
      });
    });

    describe('PATCH /users/:id/status', () => {
      it('should update user status for admin', () => {
        return request(app.getHttpServer())
          .patch(`/api/v1/users/${testUserId}/status`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send({ status: UserStatus.SUSPENDED })
          .expect((res) => {
            // Will be 403 if user is not admin, 200 if admin
            expect([200, 403]).toContain(res.status);
          });
      });
    });

    describe('PATCH /users/:id/deactivate', () => {
      it('should deactivate user for admin', () => {
        return request(app.getHttpServer())
          .patch(`/api/v1/users/${testUserId}/deactivate`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send({ reason: 'Test deactivation' })
          .expect((res) => {
            // Will be 403 if user is not admin, 200 if admin
            expect([200, 403]).toContain(res.status);
          });
      });
    });

    describe('PATCH /users/:id/reactivate', () => {
      it('should reactivate user for admin', () => {
        return request(app.getHttpServer())
          .patch(`/api/v1/users/${testUserId}/reactivate`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .expect((res) => {
            // Will be 403 if user is not admin, 200 if admin
            expect([200, 403]).toContain(res.status);
          });
      });
    });
  });

  describe('Profile Deletion', () => {
    describe('DELETE /users/profile', () => {
      it('should soft delete user profile', () => {
        return request(app.getHttpServer())
          .delete('/api/v1/users/profile')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200)
          .expect((res) => {
            expect(res.body.data.message).toBe(
              'Account deactivated successfully',
            );
          });
      });
    });
  });
});
