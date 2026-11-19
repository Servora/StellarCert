import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Public } from 'src/common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles';
import { CertificateTemplateService } from '../services/template.service';
import { CertificateTemplate } from '../entities/certificate-template.entity';
import {
  CreateCertificateTemplateDto,
  UpdateCertificateTemplateDto,
} from '../dto/certificate-template.dto';

export interface CertificateTemplateDto {
  id: string;
  name: string;
  description: string;
  layoutUrl: string;
  fields: string[];
  issuerId: string;
  previewUrl?: string;
}

const BUILTIN_TEMPLATES: CertificateTemplateDto[] = [
  {
    id: 'default',
    name: 'Standard Certificate',
    description:
      'A clean, professional certificate layout suitable for most courses and achievements.',
    layoutUrl: '/templates/standard.pdf',
    fields: ['recipientName', 'courseName', 'issuerName', 'issueDate'],
    issuerId: 'system',
    previewUrl: '/templates/standard-preview.png',
  },
  {
    id: 'academic',
    name: 'Academic Excellence',
    description: 'Formal academic certificate design with gold border accents.',
    layoutUrl: '/templates/academic.pdf',
    fields: ['recipientName', 'courseName', 'issuerName', 'grade', 'issueDate'],
    issuerId: 'system',
    previewUrl: '/templates/academic-preview.png',
  },
  {
    id: 'professional',
    name: 'Professional Training',
    description:
      'Modern professional design for corporate training and certification programs.',
    layoutUrl: '/templates/professional.pdf',
    fields: [
      'recipientName',
      'courseName',
      'issuerName',
      'issueDate',
      'expiryDate',
    ],
    issuerId: 'system',
    previewUrl: '/templates/professional-preview.png',
  },
];

@ApiTags('templates')
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templateService: CertificateTemplateService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'List all available certificate templates' })
  list(): CertificateTemplateDto[] {
    return BUILTIN_TEMPLATES;
  }

  @Get('default')
  @Public()
  @ApiOperation({ summary: 'Get the default certificate template' })
  getDefault(): CertificateTemplateDto {
    return BUILTIN_TEMPLATES[0];
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List the authenticated issuer own templates' })
  @ApiResponse({ status: 200, description: 'Issuer templates' })
  async listMine(
    @CurrentUser('id') currentUserId: string,
  ): Promise<CertificateTemplate[]> {
    return this.templateService.findAllForIssuer(currentUserId);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get a specific certificate template' })
  async getById(
    @Param('id') id: string,
    @CurrentUser('id') currentUserId?: string,
  ): Promise<CertificateTemplate | CertificateTemplateDto> {
    const builtin = BUILTIN_TEMPLATES.find((t) => t.id === id);
    if (builtin) return builtin;

    // Stored templates are UUID-keyed; only expose system rows and the
    // caller's own rows so issuers cannot enumerate competitors' branding.
    const template = await this.templateService.findByIdForRendering(id);
    if (
      template &&
      (!template.issuerId || template.issuerId === currentUserId)
    ) {
      return template;
    }
    return BUILTIN_TEMPLATES[0];
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create an issuer-owned certificate template' })
  @ApiResponse({ status: 201, description: 'Template created' })
  async create(
    @Body() dto: CreateCertificateTemplateDto,
    @CurrentUser('id') currentUserId: string,
    @CurrentUser('role') currentUserRole?: string,
  ): Promise<CertificateTemplate> {
    return this.templateService.create(dto, currentUserId, currentUserRole);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an issuer-owned certificate template' })
  @ApiResponse({ status: 200, description: 'Template updated' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCertificateTemplateDto,
    @CurrentUser('id') currentUserId: string,
    @CurrentUser('role') currentUserRole?: string,
  ): Promise<CertificateTemplate> {
    return this.templateService.update(id, dto, currentUserId, currentUserRole);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deactivate an issuer-owned certificate template' })
  @ApiResponse({ status: 204, description: 'Template deactivated' })
  async remove(
    @Param('id') id: string,
    @CurrentUser('id') currentUserId: string,
    @CurrentUser('role') currentUserRole?: string,
  ): Promise<void> {
    return this.templateService.remove(id, currentUserId, currentUserRole);
  }
}
