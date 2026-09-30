import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { CertificateSearchService } from './certificate-search.service';
import { Certificate } from '../entities/certificate.entity';

describe('CertificateSearchService', () => {
  let service: CertificateSearchService;

  const mockQueryBuilder = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(0),
    getMany: jest.fn().mockResolvedValue([]),
    getOne: jest.fn().mockResolvedValue(null),
  };

  const mockRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificateSearchService,
        {
          provide: getRepositoryToken(Certificate),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<CertificateSearchService>(CertificateSearchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('search', () => {
    it('uses parameter binding for search query and filters', async () => {
      const query = "test'; DROP TABLE certificates; --";
      const filters = {
        issuerId: 'issuer-uuid-123',
        status: 'active',
        recipientEmail: 'user@example.com',
      };

      await service.search(query, filters);

      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith(
        'certificate',
      );
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'certificate.issuer',
        'issuer',
      );

      // Verify bound parameter for query
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(certificate.title LIKE :query OR certificate.recipientName LIKE :query OR certificate.recipientEmail LIKE :query)',
        { query: `%${query}%` },
      );

      // Verify bound parameters for filters
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.issuerId = :issuerId',
        { issuerId: 'issuer-uuid-123' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.status = :status',
        { status: 'active' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.recipientEmail = :recipientEmail',
        { recipientEmail: 'user@example.com' },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'certificate.issuedAt',
        'DESC',
      );
    });

    it('works when no query or filters are provided', async () => {
      await service.search('');

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('applies pagination and parameter-bound filters', async () => {
      await service.findAll(2, 25, 'issuer-1', 'active');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.issuerId = :issuerId',
        { issuerId: 'issuer-1' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.status = :status',
        { status: 'active' },
      );
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(25);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(25);
    });
  });

  describe('findOne', () => {
    it('uses bound parameter for id and returns certificate', async () => {
      const mockCert = { id: 'cert-1' } as Certificate;
      mockQueryBuilder.getOne.mockResolvedValueOnce(mockCert);

      const result = await service.findOne('cert-1');

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'certificate.id = :id',
        { id: 'cert-1' },
      );
      expect(result).toBe(mockCert);
    });

    it('throws NotFoundException when certificate is not found', async () => {
      mockQueryBuilder.getOne.mockResolvedValueOnce(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getCertificatesByRecipient', () => {
    it('uses bound parameter for recipient email', async () => {
      await service.getCertificatesByRecipient('test@example.com');

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'certificate.recipientEmail = :email',
        { email: 'test@example.com' },
      );
    });
  });

  describe('getCertificatesByIssuer', () => {
    it('uses bound parameter for issuerId', async () => {
      await service.getCertificatesByIssuer('issuer-uuid');

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'certificate.issuerId = :issuerId',
        { issuerId: 'issuer-uuid' },
      );
    });
  });

  describe('getDuplicateCertificates', () => {
    it('uses bound parameter for isDuplicate flag', async () => {
      await service.getDuplicateCertificates();

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'certificate.isDuplicate = :isDuplicate',
        { isDuplicate: true },
      );
    });
  });

  describe('exportCertificates', () => {
    it('applies max limit and parameter-bound filters', async () => {
      await service.exportCertificates('issuer-id', 'revoked');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.issuerId = :issuerId',
        { issuerId: 'issuer-id' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.status = :status',
        { status: 'revoked' },
      );
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(1000);
    });
  });
});
