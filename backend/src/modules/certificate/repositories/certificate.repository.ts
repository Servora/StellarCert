import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  FindOptionsWhere,
  ILike,
  MoreThanOrEqual,
  LessThanOrEqual,
  Between,
  IsNull,
  Not,
} from 'typeorm';
import { Certificate } from '../entities/certificate.entity';
import { CertificateStatus } from '../constants/certificate-status.enum';
import { SearchCertificatesDto } from '../dto/search-certificates.dto';

export interface PaginatedCertificates {
  data: Certificate[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class CertificateRepository {
  constructor(
    @InjectRepository(Certificate)
    private readonly repo: Repository<Certificate>,
  ) {}

  async create(data: Partial<Certificate>): Promise<Certificate> {
    const entity = this.repo.create(data);
    return this.repo.save(entity);
  }

  async save(certificate: Certificate): Promise<Certificate> {
    return this.repo.save(certificate);
  }

  async findById(id: string): Promise<Certificate | null> {
    return this.repo
      .createQueryBuilder('cert')
      .leftJoinAndSelect('cert.issuer', 'issuer')
      .where('cert.id = :id', { id })
      .getOne();
  }

  async findByCertificateId(
    certificateId: string,
  ): Promise<Certificate | null> {
    return this.repo
      .createQueryBuilder('cert')
      .leftJoinAndSelect('cert.issuer', 'issuer')
      .where('cert.certificateId = :certificateId', { certificateId })
      .getOne();
  }

  async findByVerificationCode(
    verificationCode: string,
  ): Promise<Certificate | null> {
    return this.repo
      .createQueryBuilder('cert')
      .leftJoinAndSelect('cert.issuer', 'issuer')
      .where('cert.verificationCode = :verificationCode', { verificationCode })
      .getOne();
  }

  async findByStellarTransactionHash(
    hash: string,
  ): Promise<Certificate | null> {
    return this.repo
      .createQueryBuilder('cert')
      .leftJoinAndSelect('cert.issuer', 'issuer')
      .where('cert.stellarTransactionHash = :hash', { hash })
      .getOne();
  }

  async findByRecipientEmail(
    email: string,
    page = 1,
    limit = 10,
    issuerId?: string,
  ): Promise<PaginatedCertificates> {
    const where: FindOptionsWhere<Certificate> = { recipientEmail: email };
    if (issuerId) {
      where.issuerId = issuerId;
    }
    const [data, total] = await this.repo.findAndCount({
      where,
      relations: ['issuer'],
      order: { issuedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findByUserId(
    userId: string,
    page = 1,
    limit = 10,
  ): Promise<PaginatedCertificates> {
    const [data, total] = await this.repo
      .createQueryBuilder('cert')
      .leftJoinAndSelect('cert.issuer', 'issuer')
      .innerJoin('users', 'u', 'u.email = cert.recipientEmail')
      .where('u.id = :userId', { userId })
      .orderBy('cert.issuedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findByIssuerId(
    issuerId: string,
    page = 1,
    limit = 10,
  ): Promise<PaginatedCertificates> {
    const [data, total] = await this.repo.findAndCount({
      where: { issuerId },
      relations: ['issuer'],
      order: { issuedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async search(
    dto: SearchCertificatesDto,
    scopedIssuerId?: string,
  ): Promise<PaginatedCertificates> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 10;
    const sortBy = this.sanitizeSortField(dto.sortBy ?? 'issuedAt');
    const sortOrder = dto.sortOrder === 'ASC' ? 'ASC' : 'DESC';

    const qb = this.repo
      .createQueryBuilder('cert')
      .leftJoinAndSelect('cert.issuer', 'issuer');

    if (scopedIssuerId) {
      qb.andWhere('cert.issuerId = :scopedIssuerId', {
        scopedIssuerId: scopedIssuerId,
      });
    } else if (dto.issuerId) {
      qb.andWhere('cert.issuerId = :issuerId', { issuerId: dto.issuerId });
    }

    if (dto.recipientEmail) {
      qb.andWhere('cert.recipientEmail ILIKE :email', {
        email: `%${dto.recipientEmail}%`,
      });
    }

    if (dto.recipientName) {
      qb.andWhere('cert.recipientName ILIKE :recipientName', {
        recipientName: `%${dto.recipientName}%`,
      });
    }

    if (dto.status) {
      qb.andWhere('cert.status = :status', { status: dto.status });
    }

    if (dto.title) {
      qb.andWhere('cert.title ILIKE :title', { title: `%${dto.title}%` });
    }

    if (dto.certificateId) {
      qb.andWhere('cert.certificateId ILIKE :certId', {
        certId: `%${dto.certificateId}%`,
      });
    }

    if (dto.issuedFrom) {
      qb.andWhere('cert.issuedAt >= :issuedFrom', {
        issuedFrom: new Date(dto.issuedFrom),
      });
    }

    if (dto.issuedTo) {
      qb.andWhere('cert.issuedAt <= :issuedTo', {
        issuedTo: new Date(dto.issuedTo),
      });
    }

    if (dto.expiresFrom) {
      qb.andWhere('cert.expiresAt >= :expiresFrom', {
        expiresFrom: new Date(dto.expiresFrom),
      });
    }

    if (dto.expiresTo) {
      qb.andWhere('cert.expiresAt <= :expiresTo', {
        expiresTo: new Date(dto.expiresTo),
      });
    }

    if (dto.hasStellarTransaction === true) {
      qb.andWhere('cert.stellarTransactionHash IS NOT NULL');
    } else if (dto.hasStellarTransaction === false) {
      qb.andWhere('cert.stellarTransactionHash IS NULL');
    }

    const total = await qb.getCount();
    const data = await qb
      .orderBy(`cert.${sortBy}`, sortOrder)
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findActiveExpired(): Promise<Certificate[]> {
    return this.repo
      .createQueryBuilder('cert')
      .where('cert.status = :status', { status: CertificateStatus.ACTIVE })
      .andWhere('cert.expiresAt IS NOT NULL')
      .andWhere('cert.expiresAt <= :now', { now: new Date() })
      .getMany();
  }

  async findActiveByStellarSequence(
    maxSequence: string,
  ): Promise<Certificate[]> {
    return this.repo
      .createQueryBuilder('cert')
      .where('cert.status = :status', { status: CertificateStatus.ACTIVE })
      .andWhere('cert.stellarSequenceNumber IS NOT NULL')
      .andWhere('CAST(cert.stellarSequenceNumber AS BIGINT) <= :maxSequence', {
        maxSequence,
      })
      .getMany();
  }

  async countByStatus(): Promise<Record<CertificateStatus, number>> {
    const rows = await this.repo
      .createQueryBuilder('cert')
      .select('cert.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('cert.status')
      .getRawMany<{ status: CertificateStatus; count: string }>();

    const result: Record<CertificateStatus, number> = {
      [CertificateStatus.ACTIVE]: 0,
      [CertificateStatus.REVOKED]: 0,
      [CertificateStatus.EXPIRED]: 0,
      [CertificateStatus.PENDING]: 0,
      [CertificateStatus.FROZEN]: 0,
    };

    for (const row of rows) {
      result[row.status] = parseInt(row.count, 10);
    }

    return result;
  }

  async existsByVerificationCode(code: string): Promise<boolean> {
    return this.repo.existsBy({ verificationCode: code });
  }

  async existsByCertificateId(certificateId: string): Promise<boolean> {
    return this.repo.existsBy({ certificateId });
  }

  async remove(certificate: Certificate): Promise<void> {
    await this.repo.remove(certificate);
  }

  private sanitizeSortField(field: string): string {
    const allowed = [
      'issuedAt',
      'expiresAt',
      'title',
      'recipientName',
      'updatedAt',
      'verificationCount',
    ];
    return allowed.includes(field) ? field : 'issuedAt';
  }
}
