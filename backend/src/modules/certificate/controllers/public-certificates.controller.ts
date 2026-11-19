import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

import { Public } from '../../../common/decorators/public.decorator';
import { CertificateService } from '../certificate.service';
import { CertificateMapper } from '../mappers/certificate.mapper';
import { getAppBaseUrl } from '../../../config/public-url.config';
import type { PublicCertificateDto } from '../mappers/certificate.mapper';

/**
 * Public certificate surface (#1178).
 *
 * Serves the privacy-preserving share page data for `/c/:publicId`, plus the
 * badge endpoints an issuer embeds on LinkedIn or their own site:
 *
 *   GET /api/v1/certificates/public/:publicId         — public projection JSON
 *   GET /api/v1/certificates/public/:publicId/badge   — self-contained SVG
 *   GET /api/v1/certificates/public/:publicId/embed   — iframe-ready HTML page
 *
 * Everything here is anonymous: no email, no verification code, and lookups
 * are by the publishable serial (`certificateId`), never the internal UUID.
 * The badge and embed routes intentionally opt out of the global
 * `X-Frame-Options: DENY` / `frame-ancestors 'none'` headers — being framed by
 * a third-party profile page *is* the feature — so they set narrower CSP of
 * their own instead.
 */
@ApiTags('Public Certificates')
@Controller('certificates/public')
export class PublicCertificatesController {
  constructor(
    private readonly certificateService: CertificateService,
    private readonly mapper: CertificateMapper,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Get(':publicId')
  @ApiOperation({
    summary: 'Public projection of a certificate by its serial (share page)',
  })
  @ApiParam({
    name: 'publicId',
    description: 'Human-readable certificate serial, e.g. CERT-2026-AB12CD34',
  })
  @ApiResponse({ status: 200, description: 'Public certificate projection' })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  async getPublicCertificate(
    @Param('publicId') publicId: string,
  ): Promise<PublicCertificateDto> {
    const certificate = await this.certificateService.findByPublicId(publicId);
    return this.mapper.toPublicProjection(certificate, this.network());
  }

  @Public()
  @Get(':publicId/badge')
  @ApiOperation({
    summary: 'Embeddable SVG verification badge for a certificate',
  })
  @ApiParam({ name: 'publicId', description: 'Certificate serial' })
  async getBadge(
    @Param('publicId') publicId: string,
    @Res() res: Response,
  ): Promise<void> {
    const certificate = await this.certificateService.findByPublicId(publicId);
    const projection = this.mapper.toPublicProjection(
      certificate,
      this.network(),
    );

    // Cross-origin <img> embedding must survive the global
    // Cross-Origin-Resource-Policy: same-origin.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    // An <img>-loaded SVG cannot run script, but this one is also reachable
    // directly in a top-level document — lock it down either way.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(this.renderBadgeSvg(projection));
  }

  @Public()
  @Get(':publicId/embed')
  @ApiOperation({
    summary: 'Iframe-ready HTML page embedding the verification badge',
  })
  @ApiParam({ name: 'publicId', description: 'Certificate serial' })
  async getEmbedPage(
    @Param('publicId') publicId: string,
    @Res() res: Response,
  ): Promise<void> {
    const certificate = await this.certificateService.findByPublicId(publicId);
    const projection = this.mapper.toPublicProjection(
      certificate,
      this.network(),
    );

    // Being framed by LinkedIn or an issuer's site is this route's purpose,
    // so the app-wide DENY is replaced rather than inherited.
    res.removeHeader('X-Frame-Options');
    res.setHeader(
      'Content-Security-Policy',
      "frame-ancestors *; default-src 'none'; style-src 'unsafe-inline'",
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(this.renderEmbedHtml(projection));
  }

  private network(): 'public' | 'testnet' {
    return this.configService.get<string>('STELLAR_NETWORK') === 'testnet'
      ? 'testnet'
      : 'public';
  }

  /**
   * All certificate-sourced strings are escaped before interpolation: an SVG
   * served as image/svg+xml is parsed as XML, so an unescaped `&` or `<` in a
   * title would break the document (and an unescaped tag would be markup
   * injection into a page issuers embed on third-party sites).
   */
  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private renderBadgeSvg(projection: PublicCertificateDto): string {
    const status = projection.status;
    const palette: Record<
      PublicCertificateDto['status'],
      { badge: string; text: string; label: string }
    > = {
      valid: { badge: '#dcfce7', text: '#15803d', label: 'VALID' },
      revoked: { badge: '#fee2e2', text: '#b91c1c', label: 'REVOKED' },
      expired: { badge: '#fef3c7', text: '#b45309', label: 'EXPIRED' },
      frozen: { badge: '#e0f2fe', text: '#0369a1', label: 'FROZEN' },
    };
    const { badge, text, label } = palette[status];

    const issuer = this.escapeXml(projection.issuerName ?? 'StellarCert');
    const title = this.escapeXml(projection.title);
    const recipient = this.escapeXml(projection.recipientName);
    const labelWidth = label.length * 8 + 24;

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80" viewBox="0 0 320 80" role="img" aria-label="${this.escapeXml(`Certificate ${label}: ${projection.title} awarded to ${projection.recipientName}`)}">
  <title>${label} — ${title}</title>
  <rect x="0.5" y="0.5" width="319" height="79" rx="8" fill="#ffffff" stroke="#e2e8f0"/>
  <path d="M28 20l14 5v11c0 9-6 16.5-14 19-8-2.5-14-10-14-19V25l14-5z" fill="${badge}" stroke="${text}" stroke-width="1.5"/>
  <path d="M21.5 35.5l4.5 4.5 8-9" fill="none" stroke="${text}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="56" y="30" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#0f172a">${title}</text>
  <text x="56" y="48" font-family="Arial, sans-serif" font-size="11" fill="#475569">${recipient}</text>
  <text x="56" y="64" font-family="Arial, sans-serif" font-size="10" fill="#94a3b8">Issued by ${issuer}</text>
  <rect x="${312 - labelWidth}" y="10" width="${labelWidth}" height="20" rx="10" fill="${badge}"/>
  <text x="${312 - labelWidth / 2}" y="24" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="${text}">${label}</text>
</svg>`;
  }

  private renderEmbedHtml(projection: PublicCertificateDto): string {
    const title = this.escapeXml(`${projection.title} — verified certificate`);
    const publicUrl = this.escapeXml(
      `${getAppBaseUrl()}/c/${encodeURIComponent(projection.publicId)}`,
    );

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { margin: 0; background: transparent; font-family: Arial, sans-serif; }
  a.badge-link { display: block; width: 320px; text-decoration: none; }
  img { display: block; width: 320px; height: 80px; }
</style>
</head>
<body>
<a class="badge-link" href="${publicUrl}" target="_blank" rel="noopener noreferrer">
  <img src="./badge" alt="${this.escapeXml(`Certificate ${projection.status}: ${projection.title}`)}" width="320" height="80">
</a>
</body>
</html>`;
  }
}
