import { ApiPropertyOptional } from '@nestjs/swagger';
import { IssuerTier } from '../../../common/rate-limiting/rate-limit.types';

export class IssuerPaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Page number (1-based)',
    example: 1,
    default: 1,
    minimum: 1,
  })
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    example: 'createdAt',
  })
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['ASC', 'DESC'],
    default: 'DESC',
  })
  sortOrder?: 'ASC' | 'DESC' = 'DESC';

  @ApiPropertyOptional({
    description: 'Filter by active status',
    example: true,
  })
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Search term for name or stellar public key',
    example: 'example',
  })
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by tier',
    enum: IssuerTier,
  })
  tier?: IssuerTier;
}

export interface IPaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}