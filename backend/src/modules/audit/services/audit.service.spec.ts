import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { RequestContextService } from './request-context.service';
import { AuditLog } from '../entities';
import { AuditAction, AuditResourceType } from '../constants';

describe('AuditService', () => {
  let service: AuditService;
  let repository: Repository<AuditLog>;
  let requestContextService: RequestContextService;

  const mockAuditLog = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    action: AuditAction.USER_LOGIN,
    resourceType: AuditResourceType.USER,
    resourceId: 'user-123',
    userId: 'user-123',
    userEmail: 'test@example.com',
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0',
    correlationId: 'corr-123',
    transactionHash: null,
    resourceData: null,
    changes: null,
    metadata: {},
    status: 'success',
    errorMessage: null,
    timestamp: Date.now(),
    createdAt: new Date(),
    userRole: 'user',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        RequestContextService,
        {
          provide: getRepositoryToken(AuditLog),
          useValue: {
            create: jest.fn().mockReturnValue(mockAuditLog),
            save: jest.fn().mockResolvedValue(mockAuditLog),
            findOne: jest.fn().mockResolvedValue(mockAuditLog),
            find: jest.fn().mockResolvedValue([mockAuditLog]),
            countBy: jest.fn().mockResolvedValue(1),
            delete: jest.fn().mockResolvedValue({ affected: 10 }),
            createQueryBuilder: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    repository = module.get<Repository<AuditLog>>(
      getRepositoryToken(AuditLog),
    );
    requestContextService = module.get<RequestContextService>(
      RequestContextService,
    );
  });

  describe('log', () => {
    it('should create and save an audit log', async () => {
      const params = {
        action: AuditAction.USER_LOGIN,
        resourceType: AuditResourceType.USER,
        userId: 'user-123',
        userEmail: 'test@example.com',
        ipAddress: '127.0.0.1',
      };

      const result = await service.log(params);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_LOGIN,
          resourceType: AuditResourceType.USER,
        }),
      );
      expect(repository.save).toHaveBeenCalled();
      expect(result).toEqual(mockAuditLog);
    });

    it('should set default status to success', async () => {
      const params = {
        action: AuditAction.USER_LOGIN,
        resourceType: AuditResourceType.USER,
        ipAddress: '127.0.0.1',
      };

      await service.log(params);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'success',
        }),
      );
    });

    it('should set default ipAddress to unknown', async () => {
      const params = {
        action: AuditAction.USER_LOGIN,
        resourceType: AuditResourceType.USER,
      };

      await service.log(params);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ipAddress: 'unknown',
        }),
      );
    });

    it('should handle log errors gracefully', async () => {
      jest.spyOn(repository, 'create').mockImplementationOnce(() => {
        throw new Error('Database error');
      });

      const params = {
        action: AuditAction.USER_LOGIN,
        resourceType: AuditResourceType.USER,
        ipAddress: '127.0.0.1',
      };

      expect(() => service.log(params)).rejects.toThrow('Database error');
    });
  });

  describe('getLog', () => {
    it('should retrieve a single audit log by id', async () => {
      const result = await service.getLog('123e4567-e89b-12d3-a456-426614174000');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: '123e4567-e89b-12d3-a456-426614174000' },
      });
      expect(result).toEqual(mockAuditLog);
    });
  });

  describe('countByAction', () => {
    it('should count logs by action', async () => {
      const result = await service.countByAction(AuditAction.USER_LOGIN);

      expect(repository.countBy).toHaveBeenCalledWith({
        action: AuditAction.USER_LOGIN,
      });
      expect(result).toBe(1);
    });
  });

  describe('countByResourceType', () => {
    it('should count logs by resource type', async () => {
      const result = await service.countByResourceType(AuditResourceType.USER);

      expect(repository.countBy).toHaveBeenCalledWith({
        resourceType: AuditResourceType.USER,
      });
      expect(result).toBe(1);
    });
  });

  describe('countByUserId', () => {
    it('should count logs by user id', async () => {
      const result = await service.countByUserId('user-123');

      expect(repository.countBy).toHaveBeenCalledWith({
        userId: 'user-123',
      });
      expect(result).toBe(1);
    });
  });

  describe('getUserActions', () => {
    it('should retrieve user actions with default limit', async () => {
      const result = await service.getUserActions('user-123');

      expect(repository.find).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        order: { timestamp: 'DESC' },
        take: 50,
      });
      expect(result).toEqual([mockAuditLog]);
    });

    it('should retrieve user actions with custom limit', async () => {
      await service.getUserActions('user-123', 100);

      expect(repository.find).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        order: { timestamp: 'DESC' },
        take: 100,
      });
    });
  });

  describe('getResourceAudits', () => {
    it('should retrieve resource audits with default limit', async () => {
      const result = await service.getResourceAudits('resource-123');

      expect(repository.find).toHaveBeenCalledWith({
        where: { resourceId: 'resource-123' },
        order: { timestamp: 'DESC' },
        take: 50,
      });
      expect(result).toEqual([mockAuditLog]);
    });

    it('should retrieve resource audits with custom limit', async () => {
      await service.getResourceAudits('resource-123', 100);

      expect(repository.find).toHaveBeenCalledWith({
        where: { resourceId: 'resource-123' },
        order: { timestamp: 'DESC' },
        take: 100,
      });
    });
  });

  describe('cleanupOldLogs', () => {
    it('should delete logs older than retention days', async () => {
      const result = await service.cleanupOldLogs(90);

      expect(repository.delete).toHaveBeenCalled();
      expect(result).toBe(10);
    });
  });

  describe('search', () => {
    it('should build query builder correctly', async () => {
      const mockQueryBuilder = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest
          .fn()
          .mockResolvedValue([[mockAuditLog], 1]),
      };

      jest
        .spyOn(repository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.search({ skip: 0, take: 50 });

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'audit.timestamp',
        'DESC',
      );
      expect(result).toEqual({ data: [mockAuditLog], total: 1 });
    });
  });

  describe('exportToCsv', () => {
    it('should return message when no logs found', async () => {
      jest.spyOn(service, 'search').mockResolvedValue({ data: [], total: 0 });

      const result = await service.exportToCsv({});

      expect(result).toBe('No audit logs found');
    });

    it('should export logs as CSV', async () => {
      jest
        .spyOn(service, 'search')
        .mockResolvedValue({ data: [mockAuditLog], total: 1 });

      const result = await service.exportToCsv({});

      expect(result).toContain('ID,Action,Resource Type');
      expect(result).toContain(mockAuditLog.id);
      expect(result).toContain(AuditAction.USER_LOGIN);
    });

    it('should handle large datasets', async () => {
      const largeLogs = Array(5000)
        .fill(null)
        .map((_, i) => ({
          ...mockAuditLog,
          id: `id-${i}`,
        }));

      jest
        .spyOn(service, 'search')
        .mockResolvedValue({ data: largeLogs, total: 5000 });

      const result = await service.exportToCsv({});

      expect(result).toContain('ID,Action,Resource Type');
      expect(result.split('\n').length).toBeGreaterThan(5000);
    });
  });
});
