import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  BulkExportDto,
  ExportFiltersDto,
  MAX_BULK_EXPORT_IDS,
} from './export-filters.dto';

describe('Export DTO Validation', () => {
  describe('BulkExportDto', () => {
    it('should validate successfully with valid UUIDs and nested filters', async () => {
      const plain = {
        certificateIds: [
          'a3d8a582-bd23-4a2d-9630-6d4a2f5fd6f0',
          'b4e9b693-ce34-4b3e-a741-7e5b3f6fe7a1',
        ],
        filters: {
          search: 'data science',
          status: 'active',
          startDate: '2026-01-01T00:00:00Z',
          endDate: '2026-12-31T23:59:59Z',
          issuerId: 'c5f0c704-df45-4c4f-b852-8f6c4a7af8b2',
          limit: 50,
        },
      };

      const dto = plainToInstance(BulkExportDto, plain);
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should validate successfully when certificateIds and filters are empty or omitted', async () => {
      const dto = plainToInstance(BulkExportDto, {});
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should reject non-UUID strings in certificateIds', async () => {
      const plain = {
        certificateIds: [
          'a3d8a582-bd23-4a2d-9630-6d4a2f5fd6f0',
          'invalid-not-a-uuid',
        ],
      };

      const dto = plainToInstance(BulkExportDto, plain);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const idError = errors.find((e) => e.property === 'certificateIds');
      expect(idError).toBeDefined();
      expect(idError?.constraints).toHaveProperty('isUuid');
    });

    it('should reject non-array value for certificateIds', async () => {
      const plain = {
        certificateIds: 'a3d8a582-bd23-4a2d-9630-6d4a2f5fd6f0',
      };

      const dto = plainToInstance(BulkExportDto, plain);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const idError = errors.find((e) => e.property === 'certificateIds');
      expect(idError).toBeDefined();
      expect(idError?.constraints).toHaveProperty('isArray');
    });

    it('should reject certificateIds array exceeding MAX_BULK_EXPORT_IDS (100)', async () => {
      const ids = Array.from(
        { length: MAX_BULK_EXPORT_IDS + 1 },
        (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      );
      const plain = {
        certificateIds: ids,
      };

      const dto = plainToInstance(BulkExportDto, plain);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const idError = errors.find((e) => e.property === 'certificateIds');
      expect(idError).toBeDefined();
      expect(idError?.constraints).toHaveProperty('arrayMaxSize');
    });

    it('should recursively validate nested filters', async () => {
      const plain = {
        filters: {
          startDate: 'not-a-valid-date',
          limit: -5,
        },
      };

      const dto = plainToInstance(BulkExportDto, plain);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const filterError = errors.find((e) => e.property === 'filters');
      expect(filterError).toBeDefined();
      expect(filterError?.children?.length).toBeGreaterThan(0);
      const childProps = filterError?.children?.map((c) => c.property);
      expect(childProps).toContain('startDate');
      expect(childProps).toContain('limit');
    });
  });

  describe('ExportFiltersDto', () => {
    it('should reject invalid ISO date string', async () => {
      const dto = plainToInstance(ExportFiltersDto, {
        startDate: 'yesterday',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const dateError = errors.find((e) => e.property === 'startDate');
      expect(dateError?.constraints).toHaveProperty('isDateString');
    });

    it('should reject non-UUID issuerId in filter', async () => {
      const dto = plainToInstance(ExportFiltersDto, {
        issuerId: 'not-a-valid-uuid',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const issuerError = errors.find((e) => e.property === 'issuerId');
      expect(issuerError?.constraints).toHaveProperty('isUuid');
    });

    it('should reject limit greater than MAX_EXPORT_LIMIT', async () => {
      const dto = plainToInstance(ExportFiltersDto, {
        limit: 5000,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const limitError = errors.find((e) => e.property === 'limit');
      expect(limitError?.constraints).toHaveProperty('max');
    });
  });
});
