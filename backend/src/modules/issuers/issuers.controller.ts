import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { IssuersService } from './issuers.service';
import { CreateIssuerDto } from './dto/create-issuer.dto';
import { IssuerPaginationQueryDto } from './dto/pagination.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles';
import { IssuerTier } from '../../common/rate-limiting/rate-limit.types';
import { CacheInterceptor } from '../../common/interceptors/cache.interceptor';

@ApiTags('Issuers')
@ApiBearerAuth()
@Controller('issuers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class IssuersController {
  constructor(private readonly issuersService: IssuersService) {}

  @Post()
  async create(@Body() dto: CreateIssuerDto) {
    return this.issuersService.createIssuer(dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.issuersService.removeIssuer(id);
  }

  @Get()
  @UseInterceptors(CacheInterceptor)
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    type: String,
    example: 'createdAt',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: ['ASC', 'DESC'],
    example: 'DESC',
  })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean, example: true })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    example: 'example',
  })
  @ApiQuery({
    name: 'tier',
    required: false,
    enum: IssuerTier,
    example: IssuerTier.FREE,
  })
  async list(@Query() query: IssuerPaginationQueryDto) {
    return this.issuersService.listIssuers(query);
  }
}
