import { BadRequestException, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiBody } from '@nestjs/swagger';
import {
  BulkCertificateService,
  BULK_ISSUE_MAX_FILE_BYTES,
} from './services/bulk-certificate.service';
import {
  BulkIssuePreviewDto,
  BulkIssueDryRunResponseDto,
} from './dto/bulk-issue-certificate.dto';
import {
  Controller,
  Get,
  Query,
  UseGuards,
  Param,
  Post,
  Body,
  Patch,
  Delete,
  ParseUUIDPipe,
  Req,
  Res,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
  ForbiddenException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CertificateService } from './certificate.service';
import { CertificatePdfService } from './services/pdf.service';
import { CertificateTemplateService } from './services/template.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import type { CertificateStatsDto } from './dto/stats.dto';
import { StatsQueryDto } from './dto/stats.dto';
import { CertificateStatsService } from './services/stats.service';
import { JwtAuthGuard } from 'src/common';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UserRole } from '../../common/constants/roles';
import { IssueCertificateDto } from './dto/issue-certificate.dto';
import { RevokeCertificateDto } from './dto/revoke-certificate.dto';
import {
  FreezeCertificateDto,
  UnfreezeCertificateDto,
} from './dto/freeze-certificate.dto';
import { SearchCertificatesDto } from './dto/search-certificates.dto';
import { UpdateCertificateDto } from './dto/update-certificate.dto';
import { CreateCertificateDto } from './dto/create-certificate.dto';
import { CacheInterceptor } from '../../common/interceptors/cache.interceptor';
import { CertificateMapper } from './mappers/certificate.mapper';

interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}
import { CertificateQrResponseDto } from './dto/certificate-qr-response.dto';
import {
  ExportFiltersDto,
  BulkExportDto,
  MAX_PAGE_LIMIT,
  MAX_EXPORT_LIMIT,
} from './dto/export-filters.dto';
import { IpRateLimitGuard } from '../../common/guards/ip-rate-limit.guard';
import { getClientIp } from '../../common/utils/client-ip.util';
import { BulkSizeLimitPipe } from '../../common/pipes/bulk-size-limit.pipe';

@ApiTags('Certificates')
@Controller('certificates')
@ApiBearerAuth()
export class CertificateController {
  constructor(
    private readonly certificateService: CertificateService,
    private readonly statsService: CertificateStatsService,
    private readonly pdfService: CertificatePdfService,
    private readonly templateService: CertificateTemplateService,
    private readonly mapper: CertificateMapper,
    private readonly bulkCertificateService: BulkCertificateService,
  ) {}

  // ─── List / Search ──────────────────────────────────────────────────────────

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  @ApiOperation({ summary: 'List certificates with optional filters' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'issuerId', required: false })
  @ApiQuery({ name: 'status', required: false })
  async findAll(
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('issuerId') issuerId?: string,
    @Query('status') status?: string,
    @CurrentUser('id') currentUserId?: string,
    @CurrentUser('role') userRole?: string,
  ) {
    const pageNum = Math.max(1, +page || 1);
    const limitNum = Math.min(Math.max(1, +limit || 10), MAX_PAGE_LIMIT);
    const effectiveIssuerId =
      userRole === UserRole.ADMIN ? issuerId : (currentUserId ?? issuerId);
    const result = await this.certificateService.findAll(
      pageNum,
      limitNum,
      effectiveIssuerId,
      status,
    );
    // Service returns { certificates, total }; normalize to { data, total, page, limit, totalPages }
    const certs: any[] =
      (result as any).certificates ??
      (result as any).data ??
      (Array.isArray(result) ? result : []);
    const total: number = (result as any).total ?? certs.length;
    return {
      data: certs.map((c: any) => this.mapper.toResponse(c)),
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    };
  }

  @Get('search')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  @ApiOperation({
    summary: 'Advanced certificate search with filters and pagination',
  })
  async search(
    @Query() dto: SearchCertificatesDto,
    @CurrentUser('id') currentUserId?: string,
    @CurrentUser('role') userRole?: string,
  ) {
    // The service scopes non-admins to their own certificates; an issuerId
    // filter in the query is honoured for admins only.
    return this.certificateService.search(dto, currentUserId, userRole);
  }

  // ─── Lookup by serial (#1146) ───────────────────────────────────────────────
  // MUST be registered before @Get(':id') so "serial" is not parsed as an id.

  @Get('serial/:serialNumber')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  @ApiOperation({
    summary: 'Find a certificate by serial number (scoped to caller)',
  })
  @ApiParam({ name: 'serialNumber', description: 'Certificate serial number' })
  @ApiResponse({ status: 200, description: 'Certificate found' })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  async findBySerialNumber(
    @Param('serialNumber') serialNumber: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const cert = await this.certificateService.findBySerialNumber(
      serialNumber,
      user.id,
      user.role,
    );
    return this.mapper.toResponse(cert);
  }

  @Post('bulk')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ISSUER, UserRole.ADMIN)
  // Multer buffers uploads in memory, so cap the size before the body is
  // read: one CSV, at most 2 MB (well over the row limit in the service).
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: BULK_ISSUE_MAX_FILE_BYTES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Validate and dry-run bulk certificate issuance from CSV, queuing issuance if valid',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'CSV file containing certificate rows to issue',
        },
        metadataSchemaId: {
          type: 'string',
          format: 'uuid',
          description:
            'Optional metadata schema ID to validate certificate metadata against',
        },
        templateId: {
          type: 'string',
          format: 'uuid',
          description: 'Optional template UUID',
        },
        overrideReason: {
          type: 'string',
          description: 'Optional override reason for duplicate warnings',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Dry-run preview report and Bull queue job status',
  })
  async bulkIssue(
    @UploadedFile() file: any,
    @Body() dto: BulkIssuePreviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BulkIssueDryRunResponseDto> {
    if (!file) {
      throw new BadRequestException(
        'A CSV file must be provided via the file field',
      );
    }
    return this.bulkCertificateService.processCsvBulk(
      file.buffer,
      dto,
      user.id,
    );
  }

  // ─── Statistics ──────────────────────────────────────────────────────────────

  @Get('stats/summary')
  @Public()
  @UseInterceptors(CacheInterceptor)
  @ApiOperation({ summary: 'Get public certificate summary statistics' })
  async getPublicSummary(): Promise<Partial<CertificateStatsDto>> {
    return this.statsService.getPublicSummary();
  }

  @Get('stats/total')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ISSUER, UserRole.AUDITOR)
  @ApiOperation({ summary: 'Total certificates count' })
  async getTotalCertificates(): Promise<{ total: number }> {
    const summary = await this.statsService.getPublicSummary();
    return { total: summary.totalCertificates ?? 0 };
  }

  @Get('stats/daily-verification')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ISSUER, UserRole.AUDITOR)
  @ApiOperation({ summary: 'Daily verification statistics' })
  async getDailyVerification(
    @CurrentUser('id') currentUserId?: string,
    @CurrentUser('role') userRole?: string,
  ): Promise<{ count: number }> {
    const stats = await this.statsService.getStatistics(
      this.scopedStatsQuery({}, currentUserId, userRole),
    );
    return { count: stats.verificationStats?.dailyVerifications ?? 0 };
  }

  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ISSUER, UserRole.AUDITOR)
  @ApiOperation({ summary: 'Detailed certificate statistics' })
  async getStatistics(
    @Query() query: StatsQueryDto,
    @CurrentUser('id') currentUserId?: string,
    @CurrentUser('role') userRole?: string,
  ): Promise<CertificateStatsDto> {
    return this.statsService.getStatistics(
      this.scopedStatsQuery(query, currentUserId, userRole),
    );
  }

  /**
   * #1106 — an ISSUER's statistics are always scoped to their own issuer id;
   * any `issuerId` query parameter they pass is ignored. Cross-issuer or
   * platform-wide statistics are reserved for ADMIN and AUDITOR.
   */
  private scopedStatsQuery(
    query: StatsQueryDto,
    currentUserId?: string,
    userRole?: string,
  ): StatsQueryDto {
    if (userRole !== UserRole.ISSUER) {
      return query;
    }
    if (!currentUserId) {
      // Defensive: an ISSUER token without a subject must not fall through to
      // the unfiltered (platform-wide) query.
      throw new ForbiddenException(
        'Cannot resolve issuing account for statistics scope',
      );
    }
    return { ...query, issuerId: currentUserId };
  }

  // ─── Verification (public) ───────────────────────────────────────────────────

  @Get('verify/:code')
  @Public()
  @ApiOperation({ summary: 'Verify a certificate by its verification code' })
  @ApiParam({
    name: 'code',
    description: 'Alphanumeric certificate verification code',
  })
  @ApiResponse({ status: 200, description: 'Verification result' })
  async verifyByCode(
    @Param('code') code: string,
    @Req() req: Request,
    @Query('verifiedBy') verifiedBy?: string,
  ): Promise<unknown> {
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] ?? 'unknown';
    try {
      const cert = await this.certificateService.verifyByCode(
        code,
        verifiedBy ?? 'public',
        ipAddress,
        userAgent,
      );
      return this.mapper.toVerificationResult(cert, code);
    } catch {
      return this.mapper.toVerificationResult(null, code);
    }
  }

  @Get('verify/stellar/:hash')
  @Public()
  @ApiOperation({
    summary: 'Verify a certificate using its Stellar transaction hash',
  })
  @ApiParam({
    name: 'hash',
    description: 'Stellar blockchain transaction hash',
  })
  async verifyByStellarHash(
    @Param('hash') hash: string,
    @Req() req: Request,
  ): Promise<unknown> {
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] ?? 'unknown';
    return this.certificateService.verifyByStellarHash(
      hash,
      ipAddress,
      userAgent,
    );
  }

  // ─── Recipient & Issuer scoped ───────────────────────────────────────────────

  @Get('recipient/:email')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  @ApiOperation({ summary: 'List all certificates for a recipient email' })
  async getByRecipient(
    @Param('email') email: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @CurrentUser('id') currentUserId?: string,
    @CurrentUser('role') userRole?: string,
  ) {
    const effectiveIssuerId =
      userRole === UserRole.ADMIN ? undefined : currentUserId;
    return this.certificateService.getCertificatesByRecipient(
      email,
      +page,
      +limit,
      effectiveIssuerId,
    );
  }

  @Get('issuer/:issuerId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  @ApiOperation({ summary: 'List all certificates issued by an issuer' })
  async getByIssuer(
    @Param('issuerId', ParseUUIDPipe) issuerId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @CurrentUser('id') currentUserId?: string,
    @CurrentUser('role') userRole?: string,
  ) {
    const effectiveIssuerId =
      userRole === UserRole.ADMIN ? issuerId : (currentUserId ?? issuerId);
    return this.certificateService.getCertificatesByIssuer(
      effectiveIssuerId,
      +page,
      +limit,
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'List certificates for the authenticated recipient user',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getMyCertificates(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    // Email matching is gated on the verified flag inside the service.
    return this.certificateService.findForRecipient(user.id, +page, +limit);
  }

  @Get('user/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ISSUER, UserRole.USER)
  @ApiOperation({ summary: 'List all certificates for a user with pagination' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getUserCertificates(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.certificateService.getUserCertificates(userId, +page, +limit);
  }

  @Get('export')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ISSUER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Export certificates' })
  @ApiQuery({ name: 'issuerId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async exportCertificates(
    @Query('issuerId') issuerId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: number,
    @CurrentUser('id') currentUserId?: string,
    @CurrentUser('role') userRole?: string,
  ) {
    const effectiveIssuerId =
      userRole === UserRole.ADMIN ? issuerId : (currentUserId ?? issuerId);
    const limitNum = limit
      ? Math.min(Math.max(1, +limit), MAX_EXPORT_LIMIT)
      : MAX_EXPORT_LIMIT;
    return this.certificateService.exportCertificates(
      effectiveIssuerId,
      status,
      limitNum,
      currentUserId,
      userRole,
    );
  }

  // ─── Single Certificate ───────────────────────────────────────────────────────

  @Get(':id/pdf')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Download certificate as PDF' })
  @ApiParam({ name: 'id', description: 'Certificate UUID' })
  @ApiResponse({ status: 200, description: 'PDF file stream' })
  async getCertificatePdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const certificate = await this.certificateService.findOne(id);
    // A stale or deactivated templateId must never break the download;
    // findByIdForRendering returns null and the default layout is used.
    const template = await this.templateService.findByIdForRendering(
      certificate.templateId,
    );
    const buffer = await this.pdfService.generate(certificate, template);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${certificate.certificateId}.pdf"`,
    );
    res.end(buffer);
  }

  @Get(':id/qr')
  @ApiOperation({ summary: 'Get QR code URL for a certificate' })
  @ApiResponse({
    status: 200,
    description: 'QR code generated successfully',
    type: CertificateQrResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  async getQrCode(@Param('id') id: string): Promise<CertificateQrResponseDto> {
    return this.certificateService.getCertificateQrCode(id);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get certificate details by ID' })
  @ApiParam({ name: 'id', description: 'Certificate UUID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const cert = await this.certificateService.findOne(id);
    return this.mapper.toResponse(cert);
  }

  @Get(':id/stellar')
  @Public()
  @ApiOperation({
    summary: 'Get the Stellar blockchain record for a certificate',
  })
  async getStellarData(@Param('id', ParseUUIDPipe) id: string) {
    return this.certificateService.getStellarTransactionData(id);
  }

  @Post(':id/sync-chain')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ISSUER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Re-attempt on-chain issuance for a certificate with no Stellar transaction hash',
  })
  @ApiParam({ name: 'id', description: 'Certificate UUID' })
  @ApiResponse({
    status: 200,
    description: 'Certificate state reconciled with the Stellar network',
  })
  async syncChain(@Param('id', ParseUUIDPipe) id: string) {
    return this.certificateService.syncChain(id);
  }

  @Get(':id/verification-history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ISSUER, UserRole.AUDITOR)
  @ApiOperation({ summary: 'Get verification history for a certificate' })
  async getVerificationHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') currentUserId?: string,
    @CurrentUser('role') userRole?: string,
  ) {
    return this.certificateService.getVerificationHistory(
      id,
      currentUserId,
      userRole,
    );
  }

  @Get(':id/export')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  @ApiOperation({ summary: 'Export certificate data for backup or audit' })
  async exportCertificate(@Param('id', ParseUUIDPipe) id: string) {
    return this.certificateService.exportCertificate(id);
  }

  // ─── Issue ───────────────────────────────────────────────────────────────────

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ISSUER, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Issue a new certificate with optional Stellar blockchain record',
  })
  @ApiResponse({ status: 201, description: 'Certificate issued successfully' })
  async issue(
    @Body() dto: IssueCertificateDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<unknown> {
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] ?? 'unknown';
    const cert = await this.certificateService.issue(
      dto,
      user.id,
      ipAddress,
      userAgent,
    );
    return this.mapper.toResponse(cert);
  }

  // ─── Update ───────────────────────────────────────────────────────────────────

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ISSUER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Update non-immutable certificate fields' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCertificateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.certificateService.updateWithUser(id, dto, user.id, user.role);
  }

  // ─── Revoke ───────────────────────────────────────────────────────────────────

  @Patch(':id/revoke')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ISSUER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Revoke a certificate' })
  @ApiResponse({ status: 200, description: 'Certificate revoked' })
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevokeCertificateDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<unknown> {
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] ?? 'unknown';
    return this.certificateService.revokeWithUser(
      id,
      dto,
      user.id,
      ipAddress,
      userAgent,
      user.role,
    );
  }

  // ─── Delete ───────────────────────────────────────────────────────────────────

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a certificate (admin only)' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.certificateService.remove(id);
  }

  @Patch(':id/freeze')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ISSUER, UserRole.ADMIN)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Freeze certificate' })
  async freeze(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FreezeCertificateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.certificateService.freeze(
      id,
      dto.reason,
      dto.durationDays,
      user.id,
      user.role,
    );
  }

  @Patch(':id/unfreeze')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ISSUER, UserRole.ADMIN)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Unfreeze certificate' })
  async unfreeze(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UnfreezeCertificateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.certificateService.unfreeze(id, dto.reason, user.id, user.role);
  }

  @Post('bulk-revoke')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ISSUER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Bulk revoke certificates' })
  async bulkRevoke(
    @Body('certificateIds') certificateIds: string[],
    @Body('reason') reason?: string,
    @CurrentUser('id') issuerId?: string,
    @CurrentUser('role') userRole?: string,
  ) {
    return this.certificateService.bulkRevoke(
      certificateIds,
      reason,
      issuerId,
      userRole,
    );
  }

  @Post('export')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ISSUER, UserRole.ADMIN)
  @UsePipes(new BulkSizeLimitPipe())
  @ApiOperation({ summary: 'Bulk export certificates with filters' })
  async bulkExport(
    @Body() bulkExportDto: BulkExportDto,
    @Res() res: any,
    @CurrentUser('id') currentUserId?: string,
    @CurrentUser('role') userRole?: string,
  ) {
    const effectiveIssuerId =
      userRole === UserRole.ADMIN
        ? bulkExportDto.filters?.issuerId
        : (currentUserId ?? bulkExportDto.filters?.issuerId);

    const csvData = await this.certificateService.bulkExport(
      bulkExportDto.certificateIds || [],
      bulkExportDto.filters,
      effectiveIssuerId,
      userRole,
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="certificates-export-${new Date().toISOString().split('T')[0]}.csv"`,
    );
    res.send(csvData);
  }

  @Post('export/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ISSUER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Export all certificates matching filters' })
  async exportAllFiltered(
    @Body() filters: ExportFiltersDto,
    @Res() res: any,
    @CurrentUser('id') currentUserId?: string,
    @CurrentUser('role') userRole?: string,
  ) {
    const effectiveIssuerId =
      userRole === UserRole.ADMIN
        ? filters?.issuerId
        : (currentUserId ?? filters?.issuerId);

    const csvData = await this.certificateService.exportAllFiltered(
      filters,
      effectiveIssuerId,
      userRole,
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="certificates-export-all-${new Date().toISOString().split('T')[0]}.csv"`,
    );
    res.send(csvData);
  }
}
