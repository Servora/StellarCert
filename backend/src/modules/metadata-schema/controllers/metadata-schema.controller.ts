import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { MetadataSchemaService } from '../services/metadata-schema.service';
import {
  CreateMetadataSchemaDto,
  UpdateMetadataSchemaDto,
  ValidateMetadataDto,
  MetadataValidationResultDto,
} from '../dto/metadata-schema.dto';
import { MetadataSchema } from '../entities/metadata-schema.entity';
import { CacheInterceptor } from '../../../common/interceptors/cache.interceptor';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/constants/roles';

@ApiTags('Metadata Schemas')
@Controller('metadata-schemas')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class MetadataSchemaController {
  constructor(private readonly schemaService: MetadataSchemaService) {}

  @Post()
  @Roles(UserRole.ISSUER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new metadata schema' })
  @ApiResponse({ status: 201, description: 'Schema created' })
  @ApiResponse({ status: 409, description: 'Schema version already exists' })
  async create(
    @Body() dto: CreateMetadataSchemaDto,
    @CurrentUser('id') currentUserId: string,
  ): Promise<MetadataSchema> {
    return this.schemaService.create(dto, currentUserId);
  }

  @Get()
  @UseInterceptors(CacheInterceptor)
  @ApiOperation({ summary: 'List all active schemas' })
  @ApiQuery({ name: 'issuerId', required: false })
  async findAll(
    @Query('issuerId') issuerId?: string,
  ): Promise<MetadataSchema[]> {
    return this.schemaService.findAll(issuerId);
  }

  @Get(':id')
  @UseInterceptors(CacheInterceptor)
  @ApiOperation({ summary: 'Get schema by ID' })
  @ApiParam({ name: 'id', type: 'string' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MetadataSchema> {
    return this.schemaService.findOne(id);
  }

  @Get('name/:name')
  @UseInterceptors(CacheInterceptor)
  @ApiOperation({ summary: 'Get all versions of a schema by name' })
  async findByName(@Param('name') name: string): Promise<MetadataSchema[]> {
    return this.schemaService.findByName(name);
  }

  @Get('name/:name/latest')
  @UseInterceptors(CacheInterceptor)
  @ApiOperation({ summary: 'Get the latest version of a schema' })
  async findLatest(@Param('name') name: string): Promise<MetadataSchema> {
    const schema = await this.schemaService.findLatestByName(name);
    if (!schema) {
      throw new Error(`No schema found with name "${name}"`);
    }
    return schema;
  }

  @Get('name/:name/history')
  @UseInterceptors(CacheInterceptor)
  @ApiOperation({ summary: 'Get version history of a schema' })
  async getVersionHistory(
    @Param('name') name: string,
  ): Promise<MetadataSchema[]> {
    return this.schemaService.getVersionHistory(name);
  }

  @Put(':id')
  @Roles(UserRole.ISSUER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a schema' })
  @ApiResponse({ status: 403, description: 'Not the schema owner' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMetadataSchemaDto,
    @CurrentUser('id') currentUserId: string,
    @CurrentUser('role') currentUserRole?: string,
  ): Promise<MetadataSchema> {
    return this.schemaService.update(id, dto, currentUserId, currentUserRole);
  }

  @Post('name/:name/upgrade')
  @Roles(UserRole.ISSUER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new version of an existing schema' })
  @ApiResponse({ status: 403, description: 'Not the schema owner' })
  async upgrade(
    @Param('name') name: string,
    @Body() dto: CreateMetadataSchemaDto,
    @CurrentUser('id') currentUserId: string,
    @CurrentUser('role') currentUserRole?: string,
  ): Promise<MetadataSchema> {
    return this.schemaService.upgradeSchema(
      name,
      dto,
      currentUserId,
      currentUserRole,
    );
  }

  @Delete(':id')
  @Roles(UserRole.ISSUER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a schema' })
  @ApiResponse({ status: 403, description: 'Not the schema owner' })
  async deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') currentUserId: string,
    @CurrentUser('role') currentUserRole?: string,
  ): Promise<MetadataSchema> {
    return this.schemaService.deactivate(id, currentUserId, currentUserRole);
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate metadata against a schema' })
  @ApiResponse({ status: 200, description: 'Validation result' })
  async validate(
    @Body() dto: ValidateMetadataDto,
  ): Promise<MetadataValidationResultDto> {
    return this.schemaService.validate(dto.schemaId, dto.metadata);
  }
}
