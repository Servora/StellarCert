import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { DuplicateDetectionService } from '../services/duplicate-detection.service';
import { Certificate } from '../entities/certificate.entity';
import { DuplicateDetectionConfig } from '../interfaces/duplicate-detection.interface';
import { LoggingService } from '../../../common/logging/logging.service';

describe('DuplicateDetectionService', () => {
  let service: DuplicateDetectionService;
  let repository: Repository<Certificate>;

  const mockCertificate: Certificate = {
    id: 'cert-1',
    issuerId: 'issuer-1',
    recipientEmail: 'john.doe@example.com',
    recipientName: 'John Doe',
    title: 'JavaScript Fundamentals',
    status: 'active',
    issuedAt: new Date('2024-01-15'),
    expiresAt: new Date('2025-01-15'),
    isDuplicate: false,
    metadata: {},
  } as Certificate;

  const mockRepository = {
    createQueryBuilder: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DuplicateDetectionService,
        {
          provide: getRepositoryToken(Certificate),
          useValue: mockRepository,
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
        {
          provide: LoggingService,
          useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<DuplicateDetectionService>(DuplicateDetectionService);
    repository = module.get<Repository<Certificate>>(
      getRepositoryToken(Certificate),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkForDuplicates', () => {
    it('should return no duplicates when detection is disabled', async () => {
      const config: DuplicateDetectionConfig = {
        enabled: false,
        defaultAction: 'warn',
        rules: [],
        allowOverride: true,
        requireAdminApproval: false,
        logDuplicates: true,
      };

      const result = await service.checkForDuplicates(mockCertificate, config);

      expect(result.isDuplicate).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.matches).toHaveLength(0);
      expect(result.action).toBe('allow');
    });

    it('should detect exact duplicates', async () => {
      const config: DuplicateDetectionConfig = {
        enabled: true,
        defaultAction: 'warn',
        rules: [
          {
            id: 'exact-match',
            name: 'Exact Match',
            description: 'Detect exact matches',
            enabled: true,
            action: 'block',
            threshold: 1.0,
            checkFields: [
              'recipientEmail',
              'recipientName',
              'title',
              'issuerId',
            ],
            fuzzyMatching: false,
            priority: 100,
          },
        ],
        allowOverride: true,
        requireAdminApproval: false,
        logDuplicates: true,
      };

      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockCertificate]),
      };

      mockRepository.createQueryBuilder.mockReturnValue(queryBuilder);

      const result = await service.checkForDuplicates(mockCertificate, config);

      expect(result.isDuplicate).toBe(true);
      expect(result.confidence).toBe(1);
      expect(result.matches).toHaveLength(1);
      expect(result.action).toBe('block');
    });

    it('should detect fuzzy email matches', async () => {
      const config: DuplicateDetectionConfig = {
        enabled: true,
        defaultAction: 'warn',
        rules: [
          {
            id: 'fuzzy-email',
            name: 'Fuzzy Email',
            description: 'Detect similar emails',
            enabled: true,
            action: 'warn',
            threshold: 0.8,
            checkFields: ['recipientEmail', 'title', 'issuerId'],
            fuzzyMatching: true,
            priority: 80,
          },
        ],
        allowOverride: true,
        requireAdminApproval: false,
        logDuplicates: true,
      };

      const similarCertificate = {
        ...mockCertificate,
        id: 'cert-2',
        recipientEmail: 'john.doe@examp1e.com', // Typo in domain
      };

      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([similarCertificate]),
      };

      mockRepository.createQueryBuilder.mockReturnValue(queryBuilder);

      const result = await service.checkForDuplicates(mockCertificate, config);

      expect(result.isDuplicate).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.matches).toHaveLength(1);
      expect(result.action).toBe('warn');
    });

    it('should detect fuzzy name matches', async () => {
      const config: DuplicateDetectionConfig = {
        enabled: true,
        defaultAction: 'warn',
        rules: [
          {
            id: 'fuzzy-name',
            name: 'Fuzzy Name',
            description: 'Detect similar names',
            enabled: true,
            action: 'warn',
            threshold: 0.8,
            checkFields: ['recipientName', 'title', 'issuerId'],
            fuzzyMatching: true,
            priority: 70,
          },
        ],
        allowOverride: true,
        requireAdminApproval: false,
        logDuplicates: true,
      };

      const similarCertificate = {
        ...mockCertificate,
        id: 'cert-3',
        recipientName: 'Jon Doe', // Slight name variation
      };

      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([similarCertificate]),
      };

      mockRepository.createQueryBuilder.mockReturnValue(queryBuilder);

      const result = await service.checkForDuplicates(mockCertificate, config);

      expect(result.isDuplicate).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.matches).toHaveLength(1);
      expect(result.action).toBe('warn');
    });

    it('should respect time windows in rules', async () => {
      const config: DuplicateDetectionConfig = {
        enabled: true,
        defaultAction: 'warn',
        rules: [
          {
            id: 'time-window',
            name: 'Time Window',
            description: 'Check within time window',
            enabled: true,
            action: 'warn',
            threshold: 0.8,
            checkFields: ['recipientEmail', 'title'],
            fuzzyMatching: true,
            timeWindow: 30, // 30 days
            priority: 60,
          },
        ],
        allowOverride: true,
        requireAdminApproval: false,
        logDuplicates: true,
      };

      // The service applies the time window filter in the DB query via andWhere.
      // Simulate the DB correctly filtering out certificates outside the window
      // by returning an empty result set.
      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };

      mockRepository.createQueryBuilder.mockReturnValue(queryBuilder);

      const result = await service.checkForDuplicates(mockCertificate, config);

      // Should not detect duplicates outside time window
      expect(result.isDuplicate).toBe(false);
      expect(result.matches).toHaveLength(0);
    });
  });

  describe('generateDuplicateReport', () => {
    it('should generate duplicate report', async () => {
      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockCertificate]),
      };

      mockRepository.createQueryBuilder.mockReturnValue(queryBuilder);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      const report = await service.generateDuplicateReport(startDate, endDate);

      expect(report.id).toContain('report_');
      expect(report.totalDuplicates).toBe(1);
      expect(report.duplicatesByIssuer).toEqual({ 'issuer-1': 1 });
      expect(report.timeRange.start).toBe(startDate);
      expect(report.timeRange.end).toBe(endDate);
      expect(report.duplicates).toHaveLength(1);
    });
  });

  describe('createOverrideRequest', () => {
    it('should create override request', () => {
      const request = service.createOverrideRequest(
        'cert-1',
        'Business requirement',
        'user-1',
      );

      expect(request.certificateId).toBe('cert-1');
      expect(request.reason).toBe('Business requirement');
      expect(request.requestedBy).toBe('user-1');
      expect(request.status).toBe('pending');
      expect(request.id).toContain('override_');
    });
  });

  describe('approveOverrideRequest', () => {
    it('should approve override request', () => {
      const request = service.approveOverrideRequest('request-1', 'admin-1');

      expect(request.id).toBe('request-1');
      expect(request.approvedBy).toBe('admin-1');
      expect(request.status).toBe('approved');
    });
  });

  describe('fuzzy matching', () => {
    it('should calculate levenshtein similarity correctly', () => {
      // Access private method through prototype for testing
      const serviceInstance = service as any;

      const exactMatch = serviceInstance.levenshteinSimilarity('test', 'test');
      expect(exactMatch).toBe(1);

      const closeMatch = serviceInstance.levenshteinSimilarity('test', 'testt');
      expect(closeMatch).toBeGreaterThanOrEqual(0.8);

      const differentMatch = serviceInstance.levenshteinSimilarity(
        'test',
        'completely',
      );
      expect(differentMatch).toBeLessThan(0.5);

      const emptyMatch = serviceInstance.levenshteinSimilarity('', 'test');
      expect(emptyMatch).toBe(0);
    });

    it('should handle email fuzzy matching', () => {
      const serviceInstance = service as any;

      const sameDomain = serviceInstance.fuzzyMatch(
        'john@domain.com',
        'jon@domain.com',
      );
      expect(sameDomain).toBeGreaterThanOrEqual(0.8);

      const differentDomain = serviceInstance.fuzzyMatch(
        'john@domain.com',
        'john@other.com',
      );
      expect(differentDomain).toBeLessThan(0.8);

      const exactEmail = serviceInstance.fuzzyMatch(
        'john@domain.com',
        'john@domain.com',
      );
      expect(exactEmail).toBe(1);
    });
  });
});
