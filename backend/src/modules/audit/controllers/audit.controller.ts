import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  Res,
  UseGuards,
  Optional,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { AuditService } from '../services';
import { AuditSearchDto, AuditStatisticsDto } from '../dto';
import { AuditLog } from '../entities';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles';

import { LoggingService } from '../../../common/logging/logging.service';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    @Optional() private readonly logger?: LoggingService,
  ) {}

  /**
   * Search and filter audit logs.
   */
  @Get('logs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search audit logs',
    description:
      'Retrieves audit logs using the supplied filters. Requires administrator privileges.',
  })
  @ApiQuery({
    type: AuditSearchDto,
    required: false,
    description: 'Optional filters for searching audit logs.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Audit logs retrieved successfully.',
    type: Array,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication is required or the access token is invalid.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Access denied. Administrator privileges are required.',
  })
  async searchLogs(
    @Query() searchDto: AuditSearchDto,
  ): Promise<{ data: AuditLog[]; total: number }> {
    return this.auditService.search(searchDto);
  }

  /**
   * Get aggregated audit statistics.
   */
  @Get('statistics')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get audit statistics',
    description:
      'Retrieves aggregated audit statistics using the supplied filters.',
  })
  @ApiQuery({
    type: AuditSearchDto,
    required: false,
    description: 'Optional filters for the statistics query.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Audit statistics retrieved successfully.',
    type: AuditStatisticsDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication is required or the access token is invalid.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Access denied. Administrator privileges are required.',
  })
  async getStatistics(
    @Query() filters: AuditSearchDto,
  ): Promise<AuditStatisticsDto> {
    return this.auditService.getStatistics(filters);
  }

  /**
   * Export filtered audit logs as CSV.
   */
  @Get('export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Export audit logs as CSV',
    description:
      'Exports audit logs matching the supplied filters as a downloadable CSV file.',
  })
  @ApiQuery({
    type: AuditSearchDto,
    required: false,
    description: 'Optional filters to apply to the exported audit logs.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Audit logs exported successfully as CSV.',
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication is required or the access token is invalid.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Access denied. Administrator privileges are required.',
  })
  async exportLogs(
    @Query() searchDto: AuditSearchDto,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const csv = await this.auditService.exportToCsv(searchDto);

      res
        .status(HttpStatus.OK)
        .setHeader('Content-Type', 'text/csv; charset=utf-8')
        .setHeader(
          'Content-Disposition',
          `attachment; filename="audit-logs-${Date.now()}.csv"`,
        )
        .send(csv);
    } catch (error) {
      this.logger?.error('Failed to export audit logs', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to export audit logs',
      });
    }
  }

  /**
   * Get audit actions performed by a specific user.
   */
  @Get('user/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get user audit actions',
    description:
      'Retrieves audit actions associated with a specific user.',
  })
  @ApiParam({
    name: 'userId',
    description: 'Unique identifier of the user.',
    example: '64f8c2a91d2e4a0012345678',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: 50,
    description: 'Maximum number of audit records to return.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User audit actions retrieved successfully.',
    type: Array,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication is required or the access token is invalid.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Access denied. Administrator privileges are required.',
  })
  async getUserActions(
    @Param('userId') userId: string,
    @Query('limit') limit = 50,
  ): Promise<AuditLog[]> {
    return this.auditService.getUserActions(userId, limit);
  }

  /**
   * Get audit history for a resource.
   */
  @Get('resource/:resourceId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get resource audit trail',
    description:
      'Retrieves the audit history associated with a specific resource.',
  })
  @ApiParam({
    name: 'resourceId',
    description: 'Unique identifier of the resource.',
    example: 'resource-123',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: 50,
    description: 'Maximum number of audit records to return.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Resource audit trail retrieved successfully.',
    type: Array,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication is required or the access token is invalid.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Access denied. Administrator privileges are required.',
  })
  async getResourceAudits(
    @Param('resourceId') resourceId: string,
    @Query('limit') limit = 50,
  ): Promise<AuditLog[]> {
    return this.auditService.getResourceAudits(resourceId, limit);
  }

  /**
   * Get audit history for a certificate.
   */
  @Get('certificates/:id/history')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get certificate audit history',
    description:
      'Retrieves the audit trail associated with a specific certificate.',
  })
  @ApiParam({
    name: 'id',
    description: 'Unique identifier of the certificate.',
    example: 'certificate-123',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: 50,
    description: 'Maximum number of audit records to return.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Certificate audit history retrieved successfully.',
    type: Array,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication is required or the access token is invalid.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Access denied. Administrator privileges are required.',
  })
  async getCertificateHistory(
    @Param('id') id: string,
    @Query('limit') limit = 50,
  ): Promise<AuditLog[]> {
    return this.auditService.getResourceAudits(id, limit);
  }
}