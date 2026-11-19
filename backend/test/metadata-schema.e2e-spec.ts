import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { User, UserRole } from '../src/modules/users/entities/user.entity';

interface RegisteredUser {
  email: string;
  password: string;
  token: string;
  id: string;
}

describe('Metadata schemas (e2e) - write authorization and ownership', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let owner: RegisteredUser;
  let otherIssuer: RegisteredUser;
  let admin: RegisteredUser;
  let plainUser: RegisteredUser;

  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const schemaName = `metadata-e2e-${suffix}`;

  const schemaBody = {
    name: schemaName,
    version: '1.0.0',
    fields: [{ name: 'courseName', type: 'string', required: true }],
    allowCustomFields: true,
  };

  async function register(email: string): Promise<RegisteredUser> {
    const password = 'SecureP@ss123';
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'E2E', lastName: 'Schema' })
      .expect(201);

    return {
      email,
      password,
      token: res.body.data.accessToken,
      id: res.body.data.user.id,
    };
  }

  async function login(user: RegisteredUser): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);
    return res.body.data.accessToken;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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

    dataSource = app.get(DataSource);

    owner = await register(`owner-${suffix}@example.com`);
    otherIssuer = await register(`other-${suffix}@example.com`);
    admin = await register(`admin-${suffix}@example.com`);
    plainUser = await register(`user-${suffix}@example.com`);

    const users = dataSource.getRepository(User);
    await users.update({ id: owner.id }, { role: UserRole.ISSUER });
    await users.update({ id: otherIssuer.id }, { role: UserRole.ISSUER });
    await users.update({ id: admin.id }, { role: UserRole.ADMIN });

    // Tokens carry the role they were minted with, so sign in again after the
    // promotion; otherwise the guard still sees the registration-time `user`.
    owner.token = await login(owner);
    otherIssuer.token = await login(otherIssuer);
    admin.token = await login(admin);
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires authentication for writes', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/metadata-schemas')
      .send(schemaBody)
      .expect(401);
  });

  it('rejects schema creation by a plain user', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/metadata-schemas')
      .set('Authorization', `Bearer ${plainUser.token}`)
      .send(schemaBody)
      .expect(403);
  });

  it('lets an issuer create a schema and records them as the owner', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/metadata-schemas')
      .set('Authorization', `Bearer ${owner.token}`)
      .send(schemaBody)
      .expect(201)
      .expect((res) => {
        expect(res.body.data.ownerId).toBe(owner.id);
      });

    // A second schema is needed because the owner deactivates the first one
    // below and deactivated rows are not listed.
    await request(app.getHttpServer())
      .post('/api/v1/metadata-schemas')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ ...schemaBody, name: `${schemaName}-admin` })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.ownerId).toBe(owner.id);
      });
  });

  it('rejects updates and deletes from a different issuer', async () => {
    const schemas = await request(app.getHttpServer())
      .get('/api/v1/metadata-schemas')
      .set('Authorization', `Bearer ${otherIssuer.token}`)
      .expect(200);

    const owned = schemas.body.data.find(
      (schema: { name: string }) => schema.name === schemaName,
    );
    expect(owned).toBeDefined();

    await request(app.getHttpServer())
      .put(`/api/v1/metadata-schemas/${owned.id}`)
      .set('Authorization', `Bearer ${otherIssuer.token}`)
      .send({ description: 'hijacked' })
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/v1/metadata-schemas/${owned.id}`)
      .set('Authorization', `Bearer ${otherIssuer.token}`)
      .expect(403);
  });

  it('lets the owner update their own schema', async () => {
    const schemas = await request(app.getHttpServer())
      .get('/api/v1/metadata-schemas')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    const owned = schemas.body.data.find(
      (schema: { name: string }) => schema.name === schemaName,
    );

    await request(app.getHttpServer())
      .put(`/api/v1/metadata-schemas/${owned.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ description: 'owner edit' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.description).toBe('owner edit');
      });
  });

  it('lets an admin modify and deactivate another issuer schema', async () => {
    const schemas = await request(app.getHttpServer())
      .get('/api/v1/metadata-schemas')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);

    const owned = schemas.body.data.find(
      (schema: { name: string }) => schema.name === `${schemaName}-admin`,
    );
    expect(owned).toBeDefined();

    await request(app.getHttpServer())
      .put(`/api/v1/metadata-schemas/${owned.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ description: 'admin edit' })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/v1/metadata-schemas/${owned.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.isActive).toBe(false);
      });
  });

  it('lets the owner deactivate their own schema', async () => {
    const schemas = await request(app.getHttpServer())
      .get('/api/v1/metadata-schemas')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    const owned = schemas.body.data.find(
      (schema: { name: string }) => schema.name === schemaName,
    );

    await request(app.getHttpServer())
      .delete(`/api/v1/metadata-schemas/${owned.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.isActive).toBe(false);
      });
  });
});
