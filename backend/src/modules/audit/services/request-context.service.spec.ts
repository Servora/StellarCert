import { Test, TestingModule } from '@nestjs/testing';
import { RequestContextService } from './request-context.service';
import { IRequestContext } from '../interfaces';

describe('RequestContextService', () => {
  let service: RequestContextService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RequestContextService],
    }).compile();

    service = module.get<RequestContextService>(RequestContextService);
  });

  afterEach(() => {
    service.clearContext();
  });

  describe('setContext', () => {
    it('should set context for an id', () => {
      const context: IRequestContext = {
        userId: 'user-123',
        ipAddress: '127.0.0.1',
        timestamp: Date.now(),
      };

      service.setContext('req-1', context);

      const retrieved = service.getContext('req-1');
      expect(retrieved).toEqual(context);
    });

    it('should overwrite existing context', () => {
      const context1: IRequestContext = {
        userId: 'user-123',
        ipAddress: '127.0.0.1',
        timestamp: Date.now(),
      };

      const context2: IRequestContext = {
        userId: 'user-456',
        ipAddress: '192.168.1.1',
        timestamp: Date.now(),
      };

      service.setContext('req-1', context1);
      service.setContext('req-1', context2);

      const retrieved = service.getContext('req-1');
      expect(retrieved).toEqual(context2);
    });
  });

  describe('getContext', () => {
    it('should retrieve context by id', () => {
      const context: IRequestContext = {
        userId: 'user-123',
        ipAddress: '127.0.0.1',
        timestamp: Date.now(),
      };

      service.setContext('req-1', context);
      const retrieved = service.getContext('req-1');

      expect(retrieved).toEqual(context);
    });

    it('should return undefined if context not found', () => {
      const retrieved = service.getContext('non-existent');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('deleteContext', () => {
    it('should delete context by id', () => {
      const context: IRequestContext = {
        userId: 'user-123',
        ipAddress: '127.0.0.1',
        timestamp: Date.now(),
      };

      service.setContext('req-1', context);
      service.deleteContext('req-1');

      const retrieved = service.getContext('req-1');
      expect(retrieved).toBeUndefined();
    });

    it('should handle deleting non-existent context', () => {
      expect(() => service.deleteContext('non-existent')).not.toThrow();
    });
  });

  describe('clearContext', () => {
    it('should clear all contexts', () => {
      const context: IRequestContext = {
        userId: 'user-123',
        ipAddress: '127.0.0.1',
        timestamp: Date.now(),
      };

      service.setContext('req-1', context);
      service.setContext('req-2', context);

      service.clearContext();

      expect(service.getContext('req-1')).toBeUndefined();
      expect(service.getContext('req-2')).toBeUndefined();
    });
  });
});
