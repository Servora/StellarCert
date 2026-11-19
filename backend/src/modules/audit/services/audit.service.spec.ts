import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { RequestContextService } from './request-context.service';
import { AuditLog } from '../entities';
import { AuditAction, AuditResourceType } from '../constants';
import { LoggingService } from '../../../common/logging/logging.service';

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
  } as any as AuditLog;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        RequestContextService,
        {
          provide: LoggingService,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          },
        },
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
    repository = module.get<Repository<AuditLog>>(getRepositoryToken(AuditLog));
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

      const result = await service.log(params);
      expect(result).toBeNull();
    });

    it('should redact sensitive data in changes and metadata', async () => {
      const params = {
        action: AuditAction.USER_LOGIN,
        resourceType: AuditResourceType.USER,
        changes: {
          before: { password: 'old-password', email: 'test@example.com' },
          after: { password: 'new-password', email: 'test@example.com' },
        },
        metadata: {
          token: 'secret-token',
          nested: {
            apiKey: 'key-123',
            safe: 'data',
          },
        },
      };

      await service.log(params);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: {
            before: { password: '[REDACTED]', email: 'test@example.com' },
            after: { password: '[REDACTED]', email: 'test@example.com' },
          },
          metadata: {
            token: '[REDACTED]',
            nested: {
              apiKey: '[REDACTED]',
              safe: 'data',
            },
          },
        }),
      );
    });
  });

  describe('getLog', () => {
    it('should retrieve a single audit log by id', async () => {
      const result = await service.getLog(
        '123e4567-e89b-12d3-a456-426614174000',
      );

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
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[mockAuditLog], 1]),
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

  describe('getStatistics', () => {
    function makeStatisticsQueryBuilder() {
      // Each sub-query in getStatistics calls a fresh chain on the same
      // queryBuilder instance. We need select/addSelect/groupBy/addGroupBy/
      // orderBy/limit to be chainable and getRawMany + getCount to resolve.
      const qb: any = {
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(42),
        getRawMany: jest.fn(),
      };

      // getRawMany is called 5 times in order:
      //   1. eventsByAction
      //   2. eventsByResourceType
      //   3. eventsByStatus
      //   4. eventsPerDay
      //   5. topUsers
      //   6. topResources
      qb.getRawMany
        .mockResolvedValueOnce([
          { action: 'USER_LOGIN', count: '10' },
          { action: 'CERTIFICATE_ISSUED', count: '5' },
        ])
        .mockResolvedValueOnce([
          { resourceType: 'USER', count: '15' },
          { resourceType: 'CERTIFICATE', count: '8' },
        ])
        .mockResolvedValueOnce([
          { status: 'success', count: '20' },
          { status: 'failure', count: '3' },
        ])
        .mockResolvedValueOnce([
          { date: '2026-10-20', count: '5' },
          { date: '2026-10-21', count: '8' },
        ])
        .mockResolvedValueOnce([
          {
            userId: 'user-1',
            userEmail: 'alice@example.com',
            eventCount: '10',
          },
          { userId: 'user-2', userEmail: 'bob@example.com', eventCount: '5' },
        ])
        .mockResolvedValueOnce([
          { resourceId: 'res-1', resourceType: 'CERTIFICATE', eventCount: '7' },
          { resourceId: 'res-2', resourceType: 'USER', eventCount: '3' },
        ]);

      return qb;
    }

    it('should return aggregated statistics', async () => {
      const qb = makeStatisticsQueryBuilder();
      jest.spyOn(repository, 'createQueryBuilder').mockReturnValue(qb);

      const result = await service.getStatistics({});

      expect(result.totalEvents).toBe(42);
      expect(result.eventsByAction).toEqual({
        USER_LOGIN: 10,
        CERTIFICATE_ISSUED: 5,
      });
      expect(result.eventsByResourceType).toEqual({
        USER: 15,
        CERTIFICATE: 8,
      });
      expect(result.eventsByStatus).toEqual({ success: 20, failure: 3 });
      expect(result.eventsPerDay).toEqual({
        '2026-10-20': 5,
        '2026-10-21': 8,
      });
      expect(result.topUsers).toEqual([
        { userId: 'user-1', userEmail: 'alice@example.com', eventCount: 10 },
        { userId: 'user-2', userEmail: 'bob@example.com', eventCount: 5 },
      ]);
      expect(result.topResources).toEqual([
        { resourceId: 'res-1', resourceType: 'CERTIFICATE', eventCount: 7 },
        { resourceId: 'res-2', resourceType: 'USER', eventCount: 3 },
      ]);
    });

    it('should use quoted "eventCount" alias in orderBy so Postgres preserves case', async () => {
      const qb = makeStatisticsQueryBuilder();
      jest.spyOn(repository, 'createQueryBuilder').mockReturnValue(qb);

      await service.getStatistics({});

      // orderBy must be called with the double-quoted alias (not bare 'eventCount')
      // at least twice — once for topUsers and once for topResources.
      const orderByCalls: string[] = qb.orderBy.mock.calls.map(
        (call: any[]) => call[0],
      );
      const quotedCalls = orderByCalls.filter((arg) => arg === '"eventCount"');
      expect(quotedCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('should apply filters when provided', async () => {
      const qb = makeStatisticsQueryBuilder();
      jest.spyOn(repository, 'createQueryBuilder').mockReturnValue(qb);

      await service.getStatistics({ userId: 'user-123' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'audit.userId = :userId',
        expect.objectContaining({ userId: 'user-123' }),
      );
    });

    it('should return empty collections when no data exists', async () => {
      const qb: any = {
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      jest.spyOn(repository, 'createQueryBuilder').mockReturnValue(qb);

      const result = await service.getStatistics({});

      expect(result.totalEvents).toBe(0);
      expect(result.eventsByAction).toEqual({});
      expect(result.topUsers).toEqual([]);
      expect(result.topResources).toEqual([]);
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

      expect(result).toContain('"ID","Action","Resource Type"');
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

      expect(result).toContain('"ID","Action","Resource Type"');
      expect(result.split('\n').length).toBeGreaterThan(5000);
    });
  });
});
