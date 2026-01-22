import { Controller, Get, Query, Res, UseGuards, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuditService } from '../services';
import { AuditSearchDto, AuditStatisticsDto } from '../dto';
import { AuditLog } from '../entities';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@ApiTags('Audit')
@Controller('audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  private readonly logger = new Logger(AuditController.name);

  constructor(private auditService: AuditService) {}

  @Get('logs')
  @ApiOperation({ summary: 'Search audit logs' })
  @ApiResponse({
    status: 200,
    description: 'Audit logs retrieved successfully',
    type: Array,
  })
  async searchLogs(
    @Query() searchDto: AuditSearchDto,
  ): Promise<{ data: AuditLog[]; total: number }> {
    return this.auditService.search(searchDto);
  }

  @Get('statistics')
  @ApiOperation({ summary: 'Get audit statistics' })
  @ApiResponse({
    status: 200,
    description: 'Audit statistics retrieved successfully',
    type: AuditStatisticsDto,
  })
  async getStatistics(
    @Query() filters: AuditSearchDto,
  ): Promise<AuditStatisticsDto> {
    return this.auditService.getStatistics(filters);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export audit logs as CSV' })
  @ApiResponse({
    status: 200,
    description: 'Audit logs exported successfully',
  })
  async exportLogs(
    @Query() searchDto: AuditSearchDto,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const csv = await this.auditService.exportToCsv(searchDto);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="audit-logs-${Date.now()}.csv"`,
      );

      res.send(csv);
    } catch (error) {
      this.logger.error(`Failed to export audit logs: ${error.message}`, error.stack);
      res.status(500).json({ error: 'Failed to export audit logs' });
    }
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get user audit actions' })
  @ApiResponse({
    status: 200,
    description: 'User audit actions retrieved successfully',
    type: Array,
  })
  async getUserActions(
    @Query('limit') limit: number = 50,
  ): Promise<AuditLog[]> {
    // Note: userId should come from the authenticated user
    // This is a placeholder - implementation depends on auth strategy
    return [];
  }

  @Get('resource/:resourceId')
  @ApiOperation({ summary: 'Get resource audit trail' })
  @ApiResponse({
    status: 200,
    description: 'Resource audit trail retrieved successfully',
    type: Array,
  })
  async getResourceAudits(
    @Query('resourceId') resourceId: string,
    @Query('limit') limit: number = 50,
  ): Promise<AuditLog[]> {
    return this.auditService.getResourceAudits(resourceId, limit);
  }
}
