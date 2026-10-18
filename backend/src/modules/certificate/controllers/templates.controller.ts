import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from 'src/common/decorators/public.decorator';

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

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get a specific certificate template' })
  getById(@Param('id') id: string): CertificateTemplateDto {
    return BUILTIN_TEMPLATES.find((t) => t.id === id) ?? BUILTIN_TEMPLATES[0];
  }
}
