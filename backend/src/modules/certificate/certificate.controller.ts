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
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CertificateService } from './certificate.service';
import { CertificatePdfService } from './services/pdf.service';
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
import { ExportFiltersDto, BulkExportDto } from './dto/export-filters.dto';
import { IpRateLimitGuard } from '../../common/guards/ip-rate-limit.guard';

@ApiTags('Certificates')
@Controller('certificates')
@ApiBearerAuth()
export class CertificateController {
  constructor(
    private readonly certificateService: CertificateService,
    private readonly statsService: CertificateStatsService,
    private readonly pdfService: CertificatePdfService,
    private readonly mapper: CertificateMapper,
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
  ) {
    const pageNum = +page;
    const limitNum = +limit;
    const result = await this.certificateService.findAll(
      pageNum,
      limitNum,
      issuerId,
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
  async search(@Query() dto: SearchCertificatesDto) {
    return this.certificateService.search(dto);
  }

  // ─── Statistics ──────────────────────────────────────────────────────────────

  @Get('stats/summary')
  @Public()
  @UseInterceptors(CacheInterceptor)
  @ApiOperation({ summary: 'Get public certificate summary statistics' })
  async getPublicSummary(): Promise<Partial<CertificateStatsDto>> {
    return this.statsService.getPublicSummary();
  }

  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ISSUER, UserRole.AUDITOR)
  @ApiOperation({ summary: 'Detailed certificate statistics' })
  async getStatistics(
    @Query() query: StatsQueryDto,
  ): Promise<CertificateStatsDto> {
    return this.statsService.getStatistics(query);
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
    const ipAddress =
      (req.headers['x-forwarded-for'] as string) ?? req.ip ?? 'unknown';
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
    const ipAddress =
      (req.headers['x-forwarded-for'] as string) ?? req.ip ?? 'unknown';
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
  ) {
    return this.certificateService.getCertificatesByRecipient(
      email,
      +page,
      +limit,
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
  ) {
    return this.certificateService.getCertificatesByIssuer(
      issuerId,
      +page,
      +limit,
    );
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
  async exportCertificates(
    @Query('issuerId') issuerId?: string,
    @Query('status') status?: string,
  ) {
    return this.certificateService.exportCertificates(issuerId, status);
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
    const buffer = await this.pdfService.generate(certificate);
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

  @Get(':id/verification-history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ISSUER, UserRole.AUDITOR)
  @ApiOperation({ summary: 'Get verification history for a certificate' })
  async getVerificationHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.certificateService.getVerificationHistory(id);
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
    const ipAddress =
      (req.headers['x-forwarded-for'] as string) ?? req.ip ?? 'unknown';
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
    return this.certificateService.updateWithUser(id, dto, user.id);
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
    const ipAddress =
      (req.headers['x-forwarded-for'] as string) ?? req.ip ?? 'unknown';
    const userAgent = req.headers['user-agent'] ?? 'unknown';
    return this.certificateService.revokeWithUser(
      id,
      dto,
      user.id,
      ipAddress,
      userAgent,
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
  @ApiOperation({ summary: 'Freeze certificate' })
  async freeze(
    @Param('id') id: string,
    @Body('reason') reason?: string,
    @Body('durationDays') durationDays?: number,
  ) {
    return this.certificateService.freeze(id, reason, durationDays);
  }

  @Patch(':id/unfreeze')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ISSUER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Unfreeze certificate' })
  async unfreeze(@Param('id') id: string, @Body('reason') reason?: string) {
    return this.certificateService.unfreeze(id, reason);
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
  @ApiOperation({ summary: 'Bulk export certificates with filters' })
  async bulkExport(@Body() bulkExportDto: BulkExportDto, @Res() res: any) {
    const csvData = await this.certificateService.bulkExport(
      bulkExportDto.certificateIds || [],
      bulkExportDto.filters,
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
  async exportAllFiltered(@Body() filters: ExportFiltersDto, @Res() res: any) {
    const csvData = await this.certificateService.exportAllFiltered(filters);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="certificates-export-all-${new Date().toISOString().split('T')[0]}.csv"`,
    );
    res.send(csvData);
  }
}
