import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In, Like, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { AuditLog } from '../entities';
import { AuditAction, AuditResourceType } from '../constants';
import { AuditSearchDto, AuditStatisticsDto } from '../dto';
import { RequestContextService } from './request-context.service';

export interface LogAuditParams {
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string;
  userId?: string;
  userEmail?: string;
  userRole?: string;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
  transactionHash?: string;
  resourceData?: any;
  changes?: {
    before?: any;
    after?: any;
  };
  metadata?: Record<string, any>;
  status?: 'success' | 'failure' | 'error';
  errorMessage?: string;
  timestamp?: number;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
    private requestContextService: RequestContextService,
  ) {}

  async log(params: LogAuditParams): Promise<AuditLog> {
    try {
      const auditLog = this.auditLogRepository.create({
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        userId: params.userId,
        userEmail: params.userEmail,
        userRole: params.userRole,
        ipAddress: params.ipAddress || 'unknown',
        userAgent: params.userAgent,
        correlationId: params.correlationId,
        transactionHash: params.transactionHash,
        resourceData: params.resourceData,
        changes: params.changes,
        metadata: params.metadata,
        status: params.status || 'success',
        errorMessage: params.errorMessage,
        timestamp: params.timestamp || Date.now(),
      });

      const saved = await this.auditLogRepository.save(auditLog);
      return saved;
    } catch (error) {
      this.logger.error(`Failed to log audit event: ${error.message}`, error.stack);
      // Don't throw - audit failures should not break main operations
      throw error;
    }
  }

  async search(
    searchDto: AuditSearchDto,
  ): Promise<{ data: AuditLog[]; total: number }> {
    const query = this.auditLogRepository.createQueryBuilder('audit');

    if (searchDto.action) {
      query.andWhere('audit.action = :action', { action: searchDto.action });
    }

    if (searchDto.resourceType) {
      query.andWhere('audit.resourceType = :resourceType', {
        resourceType: searchDto.resourceType,
      });
    }

    if (searchDto.userId) {
      query.andWhere('audit.userId = :userId', { userId: searchDto.userId });
    }

    if (searchDto.userEmail) {
      query.andWhere('audit.userEmail ILIKE :userEmail', {
        userEmail: `%${searchDto.userEmail}%`,
      });
    }

    if (searchDto.resourceId) {
      query.andWhere('audit.resourceId = :resourceId', {
        resourceId: searchDto.resourceId,
      });
    }

    if (searchDto.correlationId) {
      query.andWhere('audit.correlationId = :correlationId', {
        correlationId: searchDto.correlationId,
      });
    }

    if (searchDto.ipAddress) {
      query.andWhere('audit.ipAddress = :ipAddress', {
        ipAddress: searchDto.ipAddress,
      });
    }

    if (searchDto.status) {
      query.andWhere('audit.status = :status', { status: searchDto.status });
    }

    if (searchDto.startDate || searchDto.endDate) {
      const startTime = searchDto.startDate ? new Date(searchDto.startDate).getTime() : 0;
      const endTime = searchDto.endDate
        ? new Date(searchDto.endDate).getTime() + 86400000 // Add 24 hours for end of day
        : Date.now();

      query.andWhere('audit.timestamp BETWEEN :startTime AND :endTime', {
        startTime,
        endTime,
      });
    }

    query.orderBy('audit.timestamp', 'DESC');

    const skip = searchDto.skip || 0;
    const take = Math.min(searchDto.take || 50, 500); // Max 500 records per request

    query.skip(skip).take(take);

    const [data, total] = await query.getManyAndCount();

    return { data, total };
  }

  async getStatistics(filters?: Partial<AuditSearchDto>): Promise<AuditStatisticsDto> {
    const query = this.auditLogRepository.createQueryBuilder('audit');

    if (filters?.action) {
      query.andWhere('audit.action = :action', { action: filters.action });
    }

    if (filters?.resourceType) {
      query.andWhere('audit.resourceType = :resourceType', {
        resourceType: filters.resourceType,
      });
    }

    if (filters?.userId) {
      query.andWhere('audit.userId = :userId', { userId: filters.userId });
    }

    if (filters?.startDate || filters?.endDate) {
      const startTime = filters.startDate ? new Date(filters.startDate).getTime() : 0;
      const endTime = filters.endDate ? new Date(filters.endDate).getTime() + 86400000 : Date.now();
      query.andWhere('audit.timestamp BETWEEN :startTime AND :endTime', {
        startTime,
        endTime,
      });
    }

    // Total events
    const totalEvents = await query.getCount();

    // Events by action
    const eventsByActionRaw = await query
      .select('audit.action', 'action')
      .addSelect('COUNT(*)', 'count')
      .groupBy('audit.action')
      .getRawMany();

    const eventsByAction = eventsByActionRaw.reduce(
      (acc, { action, count }) => {
        acc[action] = parseInt(count);
        return acc;
      },
      {} as Record<string, number>,
    );

    // Events by resource type
    const eventsByResourceTypeRaw = await query
      .select('audit.resourceType', 'resourceType')
      .addSelect('COUNT(*)', 'count')
      .groupBy('audit.resourceType')
      .getRawMany();

    const eventsByResourceType = eventsByResourceTypeRaw.reduce(
      (acc, { resourceType, count }) => {
        acc[resourceType] = parseInt(count);
        return acc;
      },
      {} as Record<string, number>,
    );

    // Events by status
    const eventsByStatusRaw = await query
      .select('audit.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('audit.status')
      .getRawMany();

    const eventsByStatus = eventsByStatusRaw.reduce(
      (acc, { status, count }) => {
        acc[status] = parseInt(count);
        return acc;
      },
      {} as Record<string, number>,
    );

    // Events per day
    const eventsPerDayRaw = await query
      .select("DATE(to_timestamp(audit.timestamp / 1000))", 'date')
      .addSelect('COUNT(*)', 'count')
      .groupBy("DATE(to_timestamp(audit.timestamp / 1000))")
      .orderBy("DATE(to_timestamp(audit.timestamp / 1000))", 'DESC')
      .limit(30)
      .getRawMany();

    const eventsPerDay = eventsPerDayRaw.reduce(
      (acc, { date, count }) => {
        acc[date] = parseInt(count);
        return acc;
      },
      {} as Record<string, number>,
    );

    // Top users
    const topUsersRaw = await query
      .select('audit.userId', 'userId')
      .addSelect('audit.userEmail', 'userEmail')
      .addSelect('COUNT(*)', 'eventCount')
      .groupBy('audit.userId')
      .addGroupBy('audit.userEmail')
      .orderBy('eventCount', 'DESC')
      .limit(10)
      .getRawMany();

    const topUsers = topUsersRaw.map((row) => ({
      userId: row.userId,
      userEmail: row.userEmail,
      eventCount: parseInt(row.eventCount),
    }));

    // Top resources
    const topResourcesRaw = await query
      .select('audit.resourceId', 'resourceId')
      .addSelect('audit.resourceType', 'resourceType')
      .addSelect('COUNT(*)', 'eventCount')
      .groupBy('audit.resourceId')
      .addGroupBy('audit.resourceType')
      .orderBy('eventCount', 'DESC')
      .limit(10)
      .getRawMany();

    const topResources = topResourcesRaw.map((row) => ({
      resourceId: row.resourceId,
      resourceType: row.resourceType,
      eventCount: parseInt(row.eventCount),
    }));

    return {
      totalEvents,
      eventsByAction,
      eventsByResourceType,
      eventsByStatus,
      eventsPerDay,
      topUsers,
      topResources,
    };
  }

  async exportToCsv(searchDto: AuditSearchDto): Promise<string> {
    const { data } = await this.search({ ...searchDto, skip: 0, take: 50000 });

    if (data.length === 0) {
      return 'No audit logs found';
    }

    const headers = [
      'ID',
      'Action',
      'Resource Type',
      'Resource ID',
      'User ID',
      'User Email',
      'IP Address',
      'Status',
      'Timestamp',
      'Error Message',
      'Correlation ID',
    ];

    const rows = data.map((log) => [
      log.id,
      log.action,
      log.resourceType,
      log.resourceId || '',
      log.userId || '',
      log.userEmail || '',
      log.ipAddress,
      log.status,
      new Date(log.timestamp).toISOString(),
      log.errorMessage || '',
      log.correlationId || '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    return csvContent;
  }

  async cleanupOldLogs(retentionDays: number): Promise<number> {
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    const result = await this.auditLogRepository.delete({
      timestamp: LessThanOrEqual(cutoffTime),
    });

    return result.affected || 0;
  }

  async getLog(id: string): Promise<AuditLog | null> {
    return this.auditLogRepository.findOne({ where: { id } });
  }

  async countByAction(action: AuditAction): Promise<number> {
    return this.auditLogRepository.countBy({ action });
  }

  async countByResourceType(resourceType: AuditResourceType): Promise<number> {
    return this.auditLogRepository.countBy({ resourceType });
  }

  async countByUserId(userId: string): Promise<number> {
    return this.auditLogRepository.countBy({ userId });
  }

  async getUserActions(userId: string, limit: number = 50): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { userId },
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  async getResourceAudits(resourceId: string, limit: number = 50): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { resourceId },
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }
}
