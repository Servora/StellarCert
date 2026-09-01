import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Certificate } from '../entities/certificate.entity';

@Injectable()
export class CertificateSearchService {
  private readonly logger = new Logger(CertificateSearchService.name);

  constructor(
    @InjectRepository(Certificate)
    private readonly certificateRepository: Repository<Certificate>,
  ) {}

  async findAll(
    page = 1,
    limit = 10,
    issuerId?: string,
    status?: string,
  ): Promise<{ certificates: Certificate[]; total: number }> {
    const queryBuilder = this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .orderBy('certificate.issuedAt', 'DESC');

    if (issuerId) {
      queryBuilder.andWhere('certificate.issuerId = :issuerId', { issuerId });
    }

    if (status) {
      queryBuilder.andWhere('certificate.status = :status', { status });
    }

    const total = await queryBuilder.getCount();
    const certificates = await queryBuilder
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return { certificates, total };
  }

  async findOne(id: string): Promise<Certificate> {
    const certificate = await this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .where('certificate.id = :id', { id })
      .getOne();

    if (!certificate) {
      throw new NotFoundException(`Certificate with ID ${id} not found`);
    }

    return certificate;
  }

  async getCertificatesByRecipient(email: string): Promise<Certificate[]> {
    return this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .where('certificate.recipientEmail = :email', { email })
      .orderBy('certificate.issuedAt', 'DESC')
      .getMany();
  }

  async getCertificatesByIssuer(issuerId: string): Promise<Certificate[]> {
    return this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .where('certificate.issuerId = :issuerId', { issuerId })
      .orderBy('certificate.issuedAt', 'DESC')
      .getMany();
  }

  async getDuplicateCertificates(): Promise<Certificate[]> {
    return this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .where('certificate.isDuplicate = :isDuplicate', { isDuplicate: true })
      .orderBy('certificate.issuedAt', 'DESC')
      .getMany();
  }

  async exportCertificates(
    issuerId?: string,
    status?: string,
  ): Promise<Certificate[]> {
    const queryBuilder = this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .orderBy('certificate.issuedAt', 'DESC');

    if (issuerId) {
      queryBuilder.andWhere('certificate.issuerId = :issuerId', { issuerId });
    }

    if (status) {
      queryBuilder.andWhere('certificate.status = :status', { status });
    }

    return queryBuilder.getMany();
  }

  async search(
    query: string,
    filters?: {
      issuerId?: string;
      status?: string;
      recipientEmail?: string;
    },
  ): Promise<Certificate[]> {
    const queryBuilder = this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer');

    // Text search across multiple fields
    if (query) {
      queryBuilder.andWhere(
        '(certificate.title LIKE :query OR certificate.recipientName LIKE :query OR certificate.recipientEmail LIKE :query)',
        { query: `%${query}%` },
      );
    }

    // Apply filters
    if (filters?.issuerId) {
      queryBuilder.andWhere('certificate.issuerId = :issuerId', {
        issuerId: filters.issuerId,
      });
    }

    if (filters?.status) {
      queryBuilder.andWhere('certificate.status = :status', {
        status: filters.status,
      });
    }

    if (filters?.recipientEmail) {
      queryBuilder.andWhere('certificate.recipientEmail = :recipientEmail', {
        recipientEmail: filters.recipientEmail,
      });
    }

    return queryBuilder.orderBy('certificate.issuedAt', 'DESC').getMany();
  }
}
