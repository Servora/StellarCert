import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Issuer } from './entities/issuer.entity';
import { CreateIssuerDto } from './dto/create-issuer.dto';
import { isValidStellarPublicKey } from './utils/stellar';
import {
  IssuerPaginationQueryDto,
  IPaginatedResult,
  ISSUER_SORT_FIELDS,
  ISSUER_MAX_PAGE_SIZE,
} from './dto/pagination.dto';
import { IssuerTier } from '../../common/rate-limiting/rate-limit.types';

@Injectable()
export class IssuersService {
  constructor(
    @InjectRepository(Issuer)
    private readonly issuerRepo: Repository<Issuer>,
  ) {}

  async createIssuer(dto: CreateIssuerDto) {
    if (!isValidStellarPublicKey(dto.stellarPublicKey)) {
      throw new BadRequestException('Invalid Stellar public key');
    }
    const issuer = this.issuerRepo.create(dto);
    return this.issuerRepo.save(issuer);
  }

  async removeIssuer(id: string) {
    const issuer = await this.issuerRepo.findOne({ where: { id } });
    if (!issuer) throw new NotFoundException('Issuer not found');
    return this.issuerRepo.remove(issuer);
  }

  async listIssuers(
    query: IssuerPaginationQueryDto,
  ): Promise<IPaginatedResult<Issuer>> {
    const {
      sortBy = 'createdAt',
      sortOrder = 'DESC',
      isActive,
      search,
      tier,
    } = query;
    // The DTO validates these for HTTP callers; clamp again so a direct caller
    // can never ask for an unbounded page.
    const page = Math.max(1, Math.trunc(Number(query.page)) || 1);
    const limit = Math.min(
      ISSUER_MAX_PAGE_SIZE,
      Math.max(1, Math.trunc(Number(query.limit)) || 20),
    );
    const skip = (page - 1) * limit;

    const queryBuilder = this.issuerRepo.createQueryBuilder('issuer');

    if (isActive !== undefined) {
      queryBuilder.andWhere('issuer.isActive = :isActive', { isActive });
    }

    if (search) {
      queryBuilder.andWhere(
        '(issuer.name ILIKE :search OR issuer.stellarPublicKey ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    if (tier) {
      queryBuilder.andWhere('issuer.tier = :tier', {
        tier: tier,
      });
    }

    const sortField = (ISSUER_SORT_FIELDS as readonly string[]).includes(sortBy)
      ? sortBy
      : 'createdAt';
    queryBuilder.orderBy(`issuer.${sortField}`, sortOrder);

    const [data, total] = await queryBuilder
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async incrementCertificateCount(issuerId: string) {
    await this.issuerRepo.increment({ id: issuerId }, 'certificateCount', 1);
  }
}
