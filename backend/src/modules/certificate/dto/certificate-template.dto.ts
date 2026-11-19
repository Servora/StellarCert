import {
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  Matches,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { TEMPLATE_FIELD_NAMES } from '../entities/certificate-template.entity';

/** 500 KB binary ≈ 699 KB base64; cap at 700 000 chars. */
const MAX_IMAGE_DATA_URL_LENGTH = 700_000;
const IMAGE_DATA_URL_PATTERN =
  /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export class TemplateFieldPlacementDto {
  @ApiProperty({ description: 'X coordinate in PDF points from the left' })
  @IsNumber()
  @Min(0)
  @Max(2000)
  x: number;

  @ApiProperty({ description: 'Y coordinate in PDF points from the top' })
  @IsNumber()
  @Min(0)
  @Max(2000)
  y: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(4)
  @Max(120)
  fontSize?: number;

  @ApiPropertyOptional({ enum: ['left', 'center', 'right'] })
  @IsOptional()
  @IsIn(['left', 'center', 'right'])
  align?: 'left' | 'center' | 'right';
}

export class TemplateAssetPlacementDto {
  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(2000)
  x: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(2000)
  y: number;

  @ApiProperty()
  @IsNumber()
  @Min(10)
  @Max(500)
  width: number;
}

export class TemplateLayoutDto {
  @ApiPropertyOptional({ type: TemplateAssetPlacementDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TemplateAssetPlacementDto)
  logo?: TemplateAssetPlacementDto;

  @ApiPropertyOptional({ type: TemplateAssetPlacementDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TemplateAssetPlacementDto)
  signature?: TemplateAssetPlacementDto;

  @ApiPropertyOptional({ type: TemplateAssetPlacementDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TemplateAssetPlacementDto)
  qrCode?: TemplateAssetPlacementDto;

  @ApiPropertyOptional({
    description: `Per-field placement keyed by field name (${TEMPLATE_FIELD_NAMES.join(', ')})`,
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  fields?: Record<string, TemplateFieldPlacementDto>;
}

export class CreateCertificateTemplateDto {
  @ApiProperty({ description: 'Display name, e.g. "Acme Course Certificate"' })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Certificate heading override' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  titleText?: string;

  @ApiPropertyOptional({ example: '#1a365d' })
  @IsOptional()
  @Matches(HEX_COLOR_PATTERN, { message: 'primaryColor must be a hex color' })
  primaryColor?: string;

  @ApiPropertyOptional({ example: '#b08d2e' })
  @IsOptional()
  @Matches(HEX_COLOR_PATTERN, { message: 'accentColor must be a hex color' })
  accentColor?: string;

  @ApiPropertyOptional({ description: 'Base64 data URL of the logo image' })
  @IsOptional()
  @Matches(IMAGE_DATA_URL_PATTERN, {
    message: 'logoImage must be a base64 data URL of a png/jpeg/webp/gif image',
  })
  @MaxLength(MAX_IMAGE_DATA_URL_LENGTH)
  logoImage?: string;

  @ApiPropertyOptional({
    description: 'Base64 data URL of the signature image',
  })
  @IsOptional()
  @Matches(IMAGE_DATA_URL_PATTERN, {
    message:
      'signatureImage must be a base64 data URL of a png/jpeg/webp/gif image',
  })
  @MaxLength(MAX_IMAGE_DATA_URL_LENGTH)
  signatureImage?: string;

  @ApiPropertyOptional({ enum: ['landscape', 'portrait'] })
  @IsOptional()
  @IsIn(['landscape', 'portrait'])
  orientation?: 'landscape' | 'portrait';

  @ApiPropertyOptional({ type: TemplateLayoutDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TemplateLayoutDto)
  layout?: TemplateLayoutDto;

  @ApiPropertyOptional({
    description:
      'Make this the issuer default template (replaces the previous default)',
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({
    description:
      'Admin only: owner issuer id, or "null" for a system-wide template',
  })
  @IsOptional()
  @IsString()
  issuerId?: string;
}

export class UpdateCertificateTemplateDto extends PartialType(
  OmitType(CreateCertificateTemplateDto, ['issuerId']),
) {}
