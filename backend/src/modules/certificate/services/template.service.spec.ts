import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { CertificateTemplateService } from './template.service';
import { CertificateTemplate } from '../entities/certificate-template.entity';
import { UserRole } from '../../../common/constants/roles';

describe('CertificateTemplateService', () => {
  let service: CertificateTemplateService;

  const templates: CertificateTemplate[] = [];
  const repository = {
    create: jest.fn(
      (input: Partial<CertificateTemplate>) =>
        ({ isActive: true, isDefault: false, ...input }) as CertificateTemplate,
    ),
    save: jest.fn((t: CertificateTemplate) => {
      if (!t.id) {
        t.id = `tpl-${templates.length + 1}`;
        templates.push(t);
      }
      return Promise.resolve(t);
    }),
    findOne: jest.fn(({ where }: any) => {
      const found = templates.find((t) => t.id === where.id);
      if (!found) return Promise.resolve(null);
      if (where.isActive !== undefined && found.isActive !== where.isActive) {
        return Promise.resolve(null);
      }
      return Promise.resolve(found);
    }),
    find: jest.fn(({ where }: any) =>
      Promise.resolve(
        templates.filter(
          (t) =>
            t.isActive &&
            (where.issuerId === undefined || t.issuerId === where.issuerId),
        ),
      ),
    ),
    update: jest.fn((filter: any, patch: any) => {
      const matchesIssuer = (t: CertificateTemplate) => {
        if (filter.issuerId === undefined) return true;
        // IsNull() operator (or explicit null) targets system templates.
        if (filter.issuerId === null || typeof filter.issuerId === 'object') {
          return t.issuerId === null;
        }
        return t.issuerId === filter.issuerId;
      };
      for (const t of templates) {
        if (
          matchesIssuer(t) &&
          (filter.isDefault === undefined || t.isDefault === filter.isDefault)
        ) {
          Object.assign(t, patch);
        }
      }
      return Promise.resolve({ affected: 0 });
    }),
  };

  beforeEach(async () => {
    templates.length = 0;
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificateTemplateService,
        {
          provide: getRepositoryToken(CertificateTemplate),
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get<CertificateTemplateService>(
      CertificateTemplateService,
    );
  });

  describe('create', () => {
    it('stores an issuer-owned template under the acting issuer', async () => {
      const saved = await service.create(
        { name: 'Acme Gold', primaryColor: '#123456' },
        'issuer-1',
        UserRole.ISSUER,
      );

      expect(saved.issuerId).toBe('issuer-1');
      expect(saved.primaryColor).toBe('#123456');
      expect(saved.accentColor).toBe('#b08d2e');
      expect(saved.orientation).toBe('landscape');
      expect(saved.isActive).toBe(true);
    });

    it('ignores a body-supplied issuerId from a non-admin issuer', async () => {
      const saved = await service.create(
        { name: 'Spoofed', issuerId: 'someone-else' },
        'issuer-1',
        UserRole.ISSUER,
      );

      expect(saved.issuerId).toBe('issuer-1');
    });

    it('lets an admin create a system-wide template (issuerId omitted)', async () => {
      const saved = await service.create(
        { name: 'System Gold' },
        'admin-1',
        UserRole.ADMIN,
      );

      expect(saved.issuerId).toBeNull();
    });

    it('lets an admin create a template for another issuer', async () => {
      const saved = await service.create(
        { name: 'On behalf', issuerId: 'issuer-9' },
        'admin-1',
        UserRole.ADMIN,
      );

      expect(saved.issuerId).toBe('issuer-9');
    });

    it('replaces the previous default when isDefault is set', async () => {
      await service.create(
        { name: 'First default', isDefault: true },
        'issuer-1',
        UserRole.ISSUER,
      );
      await service.create(
        { name: 'Second default', isDefault: true },
        'issuer-1',
        UserRole.ISSUER,
      );

      const defaults = templates.filter(
        (t) => t.issuerId === 'issuer-1' && t.isDefault,
      );
      expect(defaults).toHaveLength(1);
      expect(defaults[0].name).toBe('Second default');
    });

    it('sanitizes layout: unknown fields are dropped, coordinates clamped', async () => {
      const saved = await service.create(
        {
          name: 'Layout test',
          layout: {
            fields: {
              recipientName: { x: -50, y: 99999, fontSize: 900, align: 'up' },
              evilField: { x: 10, y: 10 },
            },
            logo: { x: 10, y: 20, width: 99999 },
          } as any,
        },
        'issuer-1',
        UserRole.ISSUER,
      );

      expect(saved.layout?.fields?.recipientName).toEqual({
        x: 0,
        y: 2000,
        fontSize: 120,
      });
      expect(saved.layout?.fields).not.toHaveProperty('evilField');
      expect(saved.layout?.logo).toEqual({ x: 10, y: 20, width: 500 });
    });
  });

  describe('update / remove ownership', () => {
    it('rejects updates from a different issuer', async () => {
      const tpl = await service.create(
        { name: 'Mine' },
        'issuer-1',
        UserRole.ISSUER,
      );

      await expect(
        service.update(tpl.id, { name: 'Stolen' }, 'issuer-2', UserRole.ISSUER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows the owner to update', async () => {
      const tpl = await service.create(
        { name: 'Mine' },
        'issuer-1',
        UserRole.ISSUER,
      );

      const updated = await service.update(
        tpl.id,
        { name: 'Renamed' },
        'issuer-1',
        UserRole.ISSUER,
      );

      expect(updated.name).toBe('Renamed');
    });

    it('allows an admin to update any template', async () => {
      const tpl = await service.create(
        { name: 'Theirs' },
        'issuer-1',
        UserRole.ISSUER,
      );

      const updated = await service.update(
        tpl.id,
        { name: 'Admin renamed' },
        'admin-1',
        UserRole.ADMIN,
      );

      expect(updated.name).toBe('Admin renamed');
    });

    it('soft-deletes on remove and clears the default flag', async () => {
      const tpl = await service.create(
        { name: 'Doomed', isDefault: true },
        'issuer-1',
        UserRole.ISSUER,
      );

      await service.remove(tpl.id, 'issuer-1', UserRole.ISSUER);

      expect(tpl.isActive).toBe(false);
      expect(tpl.isDefault).toBe(false);
      await expect(service.findOne(tpl.id)).resolves.toBeDefined();
      await expect(service.findByIdForRendering(tpl.id)).resolves.toBeNull();
    });

    it('rejects removal by a non-owner', async () => {
      const tpl = await service.create(
        { name: 'Theirs' },
        'issuer-1',
        UserRole.ISSUER,
      );

      await expect(
        service.remove(tpl.id, 'issuer-2', UserRole.ISSUER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for unknown ids', async () => {
      await expect(
        service.update('missing', { name: 'x' }, 'issuer-1', UserRole.ISSUER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByIdForRendering', () => {
    it('returns null for missing, null, or deactivated templates', async () => {
      const tpl = await service.create(
        { name: 'Temp' },
        'issuer-1',
        UserRole.ISSUER,
      );

      expect(await service.findByIdForRendering(undefined)).toBeNull();
      expect(await service.findByIdForRendering(null)).toBeNull();
      expect(await service.findByIdForRendering('nope')).toBeNull();

      await service.remove(tpl.id, 'issuer-1', UserRole.ISSUER);
      expect(await service.findByIdForRendering(tpl.id)).toBeNull();
    });

    it('returns an active template', async () => {
      const tpl = await service.create(
        { name: 'Live' },
        'issuer-1',
        UserRole.ISSUER,
      );

      const found = await service.findByIdForRendering(tpl.id);
      expect(found?.id).toBe(tpl.id);
    });
  });

  describe('findAllForIssuer', () => {
    it('returns only active templates of the issuer', async () => {
      await service.create({ name: 'A' }, 'issuer-1', UserRole.ISSUER);
      await service.create({ name: 'B' }, 'issuer-1', UserRole.ISSUER);
      await service.create({ name: 'C' }, 'issuer-2', UserRole.ISSUER);
      const doomed = await service.create(
        { name: 'D' },
        'issuer-1',
        UserRole.ISSUER,
      );
      await service.remove(doomed.id, 'issuer-1', UserRole.ISSUER);

      const list = await service.findAllForIssuer('issuer-1');
      expect(list.map((t) => t.name).sort()).toEqual(['A', 'B']);
    });
  });
});
