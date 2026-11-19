import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import {
  CertificateTemplate,
  TemplateFieldName,
  TEMPLATE_FIELD_NAMES,
  TemplateLayout,
  TemplateFieldPlacement,
  TemplateAssetPlacement,
} from '../entities/certificate-template.entity';
import {
  CreateCertificateTemplateDto,
  UpdateCertificateTemplateDto,
} from '../dto/certificate-template.dto';
import { UserRole } from '../../../common/constants/roles';

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

@Injectable()
export class CertificateTemplateService {
  private readonly logger = new Logger(CertificateTemplateService.name);

  constructor(
    @InjectRepository(CertificateTemplate)
    private readonly templateRepository: Repository<CertificateTemplate>,
  ) {}

  async create(
    dto: CreateCertificateTemplateDto,
    actorId: string,
    actorRole?: string,
  ): Promise<CertificateTemplate> {
    // Admins act on behalf of the platform: omitting issuerId creates a
    // system-wide template; passing one creates it for that issuer.
    // Regular issuers always own what they create.
    const issuerId =
      actorRole === UserRole.ADMIN ? (dto.issuerId ?? null) : actorId;

    if (dto.isDefault) {
      await this.clearDefault(issuerId ?? null);
    }

    const template = this.templateRepository.create({
      name: dto.name,
      description: dto.description ?? null,
      issuerId: issuerId ?? null,
      titleText: dto.titleText,
      primaryColor: dto.primaryColor ?? '#1a365d',
      accentColor: dto.accentColor ?? '#b08d2e',
      logoImage: dto.logoImage,
      signatureImage: dto.signatureImage,
      orientation: dto.orientation ?? 'landscape',
      layout: this.sanitizeLayout(dto.layout),
      isDefault: dto.isDefault ?? false,
      isActive: true,
    });

    const saved = await this.templateRepository.save(template);
    this.logger.log(
      `Certificate template created: ${saved.id} (issuer: ${saved.issuerId ?? 'system'})`,
    );
    return saved;
  }

  async update(
    id: string,
    dto: UpdateCertificateTemplateDto,
    actorId: string,
    actorRole?: string,
  ): Promise<CertificateTemplate> {
    const template = await this.findOne(id);
    this.assertOwnership(template, actorId, actorRole);

    if (dto.isDefault && !template.isDefault) {
      await this.clearDefault(template.issuerId ?? null);
    }

    if (dto.name !== undefined) template.name = dto.name;
    if (dto.description !== undefined) template.description = dto.description;
    if (dto.titleText !== undefined) template.titleText = dto.titleText;
    if (dto.primaryColor !== undefined)
      template.primaryColor = dto.primaryColor;
    if (dto.accentColor !== undefined) template.accentColor = dto.accentColor;
    if (dto.logoImage !== undefined) template.logoImage = dto.logoImage;
    if (dto.signatureImage !== undefined)
      template.signatureImage = dto.signatureImage;
    if (dto.orientation !== undefined) template.orientation = dto.orientation;
    if (dto.layout !== undefined)
      template.layout = this.sanitizeLayout(dto.layout);
    if (dto.isDefault !== undefined) template.isDefault = dto.isDefault;

    return this.templateRepository.save(template);
  }

  async remove(id: string, actorId: string, actorRole?: string): Promise<void> {
    const template = await this.findOne(id);
    this.assertOwnership(template, actorId, actorRole);
    template.isActive = false;
    template.isDefault = false;
    await this.templateRepository.save(template);
    this.logger.log(`Certificate template deactivated: ${id}`);
  }

  async findOne(id: string): Promise<CertificateTemplate> {
    const template = await this.templateRepository.findOne({ where: { id } });
    if (!template) throw new NotFoundException(`Template ${id} not found`);
    return template;
  }

  /** Templates owned by an issuer, active only. */
  async findAllForIssuer(issuerId: string): Promise<CertificateTemplate[]> {
    return this.templateRepository.find({
      where: { issuerId, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Resolve a template for PDF rendering. Returns null for unknown or
   * deactivated templates so the caller falls back to the default layout —
   * a stale `templateId` on a certificate must never break PDF download.
   */
  async findByIdForRendering(
    id?: string | null,
  ): Promise<CertificateTemplate | null> {
    if (!id) return null;
    const template = await this.templateRepository.findOne({
      where: { id, isActive: true },
    });
    return template ?? null;
  }

  private assertOwnership(
    template: CertificateTemplate,
    actorId: string,
    actorRole?: string,
  ): void {
    if (actorRole === UserRole.ADMIN) return;
    if (template.issuerId === actorId) return;
    throw new ForbiddenException('You do not own this certificate template');
  }

  private async clearDefault(issuerId: string | null): Promise<void> {
    if (issuerId === null) {
      await this.templateRepository.update(
        { issuerId: IsNull(), isDefault: true },
        { isDefault: false },
      );
      return;
    }
    await this.templateRepository.update(
      { issuerId, isDefault: true },
      { isDefault: false },
    );
  }

  /**
   * Keep only known field names with finite coordinates inside sane bounds.
   * The DTO validates shapes, but `fields` is an open record so its keys and
   * values need a second pass before the renderer trusts them.
   */
  sanitizeLayout(
    layout?: TemplateLayout | Record<string, unknown> | null,
  ): TemplateLayout | undefined {
    if (!layout || typeof layout !== 'object') return undefined;

    const source = layout as Record<string, unknown>;
    const sanitized: TemplateLayout = {};

    sanitized.logo = this.sanitizeAssetPlacement(source.logo);
    sanitized.signature = this.sanitizeAssetPlacement(source.signature);
    sanitized.qrCode = this.sanitizeAssetPlacement(source.qrCode);

    const fields = source.fields;
    if (fields && typeof fields === 'object') {
      const sanitizedFields: TemplateLayout['fields'] = {};
      for (const name of TEMPLATE_FIELD_NAMES) {
        const placement = this.sanitizeFieldPlacement(
          (fields as Record<string, unknown>)[name],
        );
        if (placement) sanitizedFields[name] = placement;
      }
      if (Object.keys(sanitizedFields).length > 0) {
        sanitized.fields = sanitizedFields;
      }
    }

    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  }

  private sanitizeAssetPlacement(
    value: unknown,
  ): TemplateAssetPlacement | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const v = value as Record<string, unknown>;
    const x = this.clampCoordinate(v.x);
    const y = this.clampCoordinate(v.y);
    const width = this.clampNumber(v.width, 10, 500);
    if (x === undefined || y === undefined || width === undefined) {
      return undefined;
    }
    return { x, y, width };
  }

  private sanitizeFieldPlacement(
    value: unknown,
  ): TemplateFieldPlacement | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const v = value as Record<string, unknown>;
    const x = this.clampCoordinate(v.x);
    const y = this.clampCoordinate(v.y);
    if (x === undefined || y === undefined) return undefined;

    const placement: TemplateFieldPlacement = { x, y };
    const fontSize = this.clampNumber(v.fontSize, 4, 120);
    if (fontSize !== undefined) placement.fontSize = fontSize;
    if (v.align === 'left' || v.align === 'center' || v.align === 'right') {
      placement.align = v.align;
    }
    return placement;
  }

  private clampCoordinate(value: unknown): number | undefined {
    return this.clampNumber(value, 0, 2000);
  }

  private clampNumber(
    value: unknown,
    min: number,
    max: number,
  ): number | undefined {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return undefined;
    return Math.min(Math.max(num, min), max);
  }

  /** Exposed for the PDF renderer to validate colours at render time too. */
  static isHexColor(value: unknown): value is string {
    return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
  }
}
