import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { VersioningModule } from '../src/common/versioning/versioning.module';

describe('API Versioning (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [VersioningModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Enable versioning
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/versions (GET)', () => {
    it('should return API version information', () => {
      return request(app.getHttpServer())
        .get('/v1/versions')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('currentVersion');
          expect(res.body).toHaveProperty('supportedVersions');
          expect(res.body).toHaveProperty('versions');
          expect(Array.isArray(res.body.supportedVersions)).toBe(true);
          expect(Array.isArray(res.body.versions)).toBe(true);
        });
    });

    it('should include version details', () => {
      return request(app.getHttpServer())
        .get('/v1/versions')
        .expect(200)
        .expect((res) => {
          const versions = res.body.versions;
          expect(versions.length).toBeGreaterThan(0);

          versions.forEach(
            (version: { version: string; deprecated: boolean }) => {
              expect(version).toHaveProperty('version');
              expect(version).toHaveProperty('deprecated');
              expect(typeof version.deprecated).toBe('boolean');
            },
          );
        });
    });
  });

  describe('/versions/migration-guide (GET)', () => {
    it('should return migration guide for valid version pair', () => {
      return request(app.getHttpServer())
        .get('/v1/versions/migration-guide?from=1&to=2')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('fromVersion');
          expect(res.body).toHaveProperty('toVersion');
          expect(res.body).toHaveProperty('breakingChanges');
          expect(res.body).toHaveProperty('newFeatures');
          expect(res.body).toHaveProperty('migrationSteps');
          expect(Array.isArray(res.body.breakingChanges)).toBe(true);
          expect(Array.isArray(res.body.newFeatures)).toBe(true);
          expect(Array.isArray(res.body.migrationSteps)).toBe(true);
        });
    });

    it('should include migration steps', () => {
      return request(app.getHttpServer())
        .get('/v1/versions/migration-guide?from=1&to=2')
        .expect(200)
        .expect((res) => {
          expect(res.body.migrationSteps.length).toBeGreaterThan(0);
        });
    });
  });

  describe('Version Compatibility', () => {
    it('should support v1 endpoints', () => {
      return request(app.getHttpServer())
        .get('/v1/versions')
        .expect(200)
        .expect((res) => {
          expect(res.body.supportedVersions).toContain('1');
        });
    });

    it('should return consistent version information', async () => {
      const response1 = await request(app.getHttpServer()).get('/v1/versions');
      const response2 = await request(app.getHttpServer()).get('/v1/versions');

      expect(response1.body).toEqual(response2.body);
    });
  });
});
