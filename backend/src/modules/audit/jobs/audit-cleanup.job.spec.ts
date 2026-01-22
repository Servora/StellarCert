import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuditCleanupJob } from './audit-cleanup.job';
import { AuditService } from '../services';
import { AuditAction, AuditResourceType } from '../constants';

describe('AuditCleanupJob', () => {
  let job: AuditCleanupJob;
  let auditService: AuditService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditCleanupJob,
        {
          provide: AuditService,
          useValue: {
            log: jest.fn().mockResolvedValue({}),
            cleanupOldLogs: jest.fn().mockResolvedValue(10),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue: any) => {
              if (key === 'audit.retentionDays') return 90;
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    job = module.get<AuditCleanupJob>(AuditCleanupJob);
    auditService = module.get<AuditService>(AuditService);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('handleCron', () => {
    it('should cleanup old logs based on retention days', async () => {
      await job.handleCron();

      expect(configService.get).toHaveBeenCalledWith(
        'audit.retentionDays',
        90,
      );
      expect(auditService.cleanupOldLogs).toHaveBeenCalledWith(90);
    });

    it('should log cleanup start event', async () => {
      await job.handleCron();

      const calls = (auditService.log as jest.Mock).mock.calls;
      const startCall = calls.find(
        (call) =>
          call[0].action === AuditAction.BACKGROUND_JOB_START,
      );

      expect(startCall).toBeDefined();
      expect(startCall[0]).toEqual(
        expect.objectContaining({
          action: AuditAction.BACKGROUND_JOB_START,
          resourceType: AuditResourceType.SYSTEM,
          resourceId: 'audit-cleanup',
          status: 'success',
        }),
      );
    });

    it('should log cleanup completion with deleted count', async () => {
      jest.spyOn(auditService, 'cleanupOldLogs').mockResolvedValue(10);

      await job.handleCron();

      const calls = (auditService.log as jest.Mock).mock.calls;
      const completeCall = calls.find(
        (call) =>
          call[0].action === AuditAction.BACKGROUND_JOB_COMPLETE,
      );

      expect(completeCall).toBeDefined();
      expect(completeCall[0]).toEqual(
        expect.objectContaining({
          action: AuditAction.BACKGROUND_JOB_COMPLETE,
          resourceType: AuditResourceType.SYSTEM,
          resourceId: 'audit-cleanup',
          metadata: expect.objectContaining({
            deletedCount: 10,
            retentionDays: 90,
          }),
          status: 'success',
        }),
      );
    });

    it('should handle cleanup errors gracefully', async () => {
      const error = new Error('Cleanup failed');
      jest
        .spyOn(auditService, 'cleanupOldLogs')
        .mockRejectedValue(error);

      await job.handleCron();

      const calls = (auditService.log as jest.Mock).mock.calls;
      const errorCall = calls.find(
        (call) =>
          call[0].action === AuditAction.BACKGROUND_JOB_FAILED,
      );

      expect(errorCall).toBeDefined();
      expect(errorCall[0]).toEqual(
        expect.objectContaining({
          action: AuditAction.BACKGROUND_JOB_FAILED,
          resourceType: AuditResourceType.SYSTEM,
          resourceId: 'audit-cleanup',
          status: 'error',
          errorMessage: 'Cleanup failed',
        }),
      );
    });

    it('should use default retention days if not configured', async () => {
      (configService.get as jest.Mock).mockImplementation(
        (key: string, defaultValue: any) => defaultValue,
      );

      await job.handleCron();

      expect(auditService.cleanupOldLogs).toHaveBeenCalledWith(90);
    });

    it('should use custom retention days from config', async () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'audit.retentionDays') return 180;
        return null;
      });

      await job.handleCron();

      expect(auditService.cleanupOldLogs).toHaveBeenCalledWith(180);
    });

    it('should set ipAddress to system for cleanup logs', async () => {
      await job.handleCron();

      const calls = (auditService.log as jest.Mock).mock.calls;

      calls.forEach((call) => {
        expect(call[0].ipAddress).toBe('system');
      });
    });
  });
});
