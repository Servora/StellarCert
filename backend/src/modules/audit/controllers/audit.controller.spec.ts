import { Test, TestingModule } from '@nestjs/testing';
import { AuditController } from './audit.controller';
import { AuditService } from '../services';
import { AuditAction, AuditResourceType } from '../constants';
import { Response } from 'express';

describe('AuditController', () => {
  let controller: AuditController;
  let service: AuditService;

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
      controllers: [AuditController],
      providers: [
        {
          provide: AuditService,
          useValue: {
            search: jest.fn(),
            getStatistics: jest.fn(),
            exportToCsv: jest.fn(),
            getUserActions: jest.fn(),
            getResourceAudits: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuditController>(AuditController);
    service = module.get<AuditService>(AuditService);
  });

  describe('searchLogs', () => {
    it('should return paginated audit logs', async () => {
      const expectedResult = { data: [mockAuditLog], total: 1 };
      jest.spyOn(service, 'search').mockResolvedValue(expectedResult);

      const result = await controller.searchLogs({ skip: 0, take: 50 });

      expect(service.search).toHaveBeenCalledWith({ skip: 0, take: 50 });
      expect(result).toEqual(expectedResult);
    });

    it('should filter by action', async () => {
      const expectedResult = { data: [mockAuditLog], total: 1 };
      jest.spyOn(service, 'search').mockResolvedValue(expectedResult);

      await controller.searchLogs({ action: AuditAction.USER_LOGIN });

      expect(service.search).toHaveBeenCalledWith({
        action: AuditAction.USER_LOGIN,
      });
    });

    it('should filter by resource type', async () => {
      const expectedResult = { data: [mockAuditLog], total: 1 };
      jest.spyOn(service, 'search').mockResolvedValue(expectedResult);

      await controller.searchLogs({ resourceType: AuditResourceType.USER });

      expect(service.search).toHaveBeenCalledWith({
        resourceType: AuditResourceType.USER,
      });
    });

    it('should filter by user id', async () => {
      const expectedResult = { data: [mockAuditLog], total: 1 };
      jest.spyOn(service, 'search').mockResolvedValue(expectedResult);

      await controller.searchLogs({ userId: 'user-123' });

      expect(service.search).toHaveBeenCalledWith({
        userId: 'user-123',
      });
    });

    it('should filter by date range', async () => {
      const expectedResult = { data: [mockAuditLog], total: 1 };
      jest.spyOn(service, 'search').mockResolvedValue(expectedResult);

      await controller.searchLogs({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(service.search).toHaveBeenCalledWith({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });
    });
  });

  describe('getStatistics', () => {
    it('should return audit statistics', async () => {
      const expectedResult = {
        totalEvents: 100,
        eventsByAction: { USER_LOGIN: 50, USER_LOGOUT: 50 },
        eventsByResourceType: { USER: 100 },
        eventsByStatus: { success: 100 },
        eventsPerDay: { '2024-01-20': 50, '2024-01-21': 50 },
        topUsers: [
          { userId: 'user-123', userEmail: 'test@example.com', eventCount: 50 },
        ],
        topResources: [
          { resourceId: 'resource-1', resourceType: 'USER', eventCount: 100 },
        ],
      };

      jest.spyOn(service, 'getStatistics').mockResolvedValue(expectedResult);

      const result = await controller.getStatistics({});

      expect(service.getStatistics).toHaveBeenCalledWith({});
      expect(result).toEqual(expectedResult);
    });

    it('should apply filters to statistics', async () => {
      const expectedResult = {
        totalEvents: 50,
        eventsByAction: { USER_LOGIN: 50 },
        eventsByResourceType: { USER: 50 },
        eventsByStatus: { success: 50 },
        eventsPerDay: { '2024-01-20': 50 },
        topUsers: [
          { userId: 'user-123', userEmail: 'test@example.com', eventCount: 50 },
        ],
        topResources: [],
      };

      jest.spyOn(service, 'getStatistics').mockResolvedValue(expectedResult);

      await controller.getStatistics({ action: AuditAction.USER_LOGIN });

      expect(service.getStatistics).toHaveBeenCalledWith({
        action: AuditAction.USER_LOGIN,
      });
    });
  });

  describe('exportLogs', () => {
    let mockRes: Partial<Response>;

    beforeEach(() => {
      mockRes = {
        setHeader: jest.fn().mockReturnThis(),
        send: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
    });

    it('should export logs as CSV', async () => {
      const csvData = 'ID,Action\ntest-id,USER_LOGIN';
      jest.spyOn(service, 'exportToCsv').mockResolvedValue(csvData);

      await controller.exportLogs({}, mockRes as Response);

      expect(service.exportToCsv).toHaveBeenCalledWith({});
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/csv; charset=utf-8',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringMatching(/attachment; filename="audit-logs-\d+\.csv"/),
      );
      expect(mockRes.send).toHaveBeenCalledWith(csvData);
    });

    it('should handle export errors', async () => {
      jest
        .spyOn(service, 'exportToCsv')
        .mockRejectedValue(new Error('Export failed'));

      await controller.exportLogs({}, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to export audit logs',
      });
    });

    it('should apply filters to export', async () => {
      const csvData = 'ID,Action\ntest-id,USER_LOGIN';
      jest.spyOn(service, 'exportToCsv').mockResolvedValue(csvData);

      await controller.exportLogs(
        { userId: 'user-123', skip: 0, take: 50 },
        mockRes as Response,
      );

      expect(service.exportToCsv).toHaveBeenCalledWith({
        userId: 'user-123',
        skip: 0,
        take: 50,
      });
    });
  });

  describe('getResourceAudits', () => {
    it('should retrieve resource audit trail', async () => {
      jest
        .spyOn(service, 'getResourceAudits')
        .mockResolvedValue([mockAuditLog]);

      const result = await controller.getResourceAudits('resource-123', 50);

      expect(service.getResourceAudits).toHaveBeenCalledWith('resource-123', 50);
      expect(result).toEqual([mockAuditLog]);
    });

    it('should use default limit if not provided', async () => {
      jest
        .spyOn(service, 'getResourceAudits')
        .mockResolvedValue([mockAuditLog]);

      await controller.getResourceAudits('resource-123');

      expect(service.getResourceAudits).toHaveBeenCalledWith('resource-123', 50);
    });
  });
});
