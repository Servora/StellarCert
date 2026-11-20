import { StorageService, resolveStorageRegion } from './storage.service';

describe('resolveStorageRegion', () => {
  it('uses the configured region when there is one', () => {
    expect(resolveStorageRegion('eu-west-2', undefined)).toBe('eu-west-2');
    expect(resolveStorageRegion(' eu-west-2 ', 'http://minio:9000')).toBe(
      'eu-west-2',
    );
  });

  it('defaults to us-east-1 only when talking to AWS (no custom endpoint)', () => {
    expect(resolveStorageRegion(undefined, undefined)).toBe('us-east-1');
    expect(resolveStorageRegion('', '')).toBe('us-east-1');
    expect(resolveStorageRegion('  ', '   ')).toBe('us-east-1');
  });

  it('does not invent a region when a custom endpoint is configured', () => {
    expect(resolveStorageRegion(undefined, 'http://minio:9000')).toBeNull();
    expect(resolveStorageRegion('', 'http://minio:9000')).toBeNull();
  });
});

describe('StorageService region handling', () => {
  const base = {
    STORAGE_BUCKET: 'bucket',
    STORAGE_ACCESS_KEY: 'key',
    STORAGE_SECRET_KEY: 'secret',
  };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const build = (config: Record<string, unknown>) =>
    new StorageService(
      { get: (k: string) => ({ ...base, ...config })[k] } as never,
      logger as never,
    );

  beforeEach(() => jest.clearAllMocks());

  it('creates a client with the default region when no endpoint is set', async () => {
    const service = build({});
    const client = (service as any).s3Client;
    expect(client).not.toBeNull();
    expect(await client.config.region()).toBe('us-east-1');
  });

  it('creates a client with the explicit region for a custom endpoint', async () => {
    const service = build({
      STORAGE_ENDPOINT: 'http://minio:9000',
      STORAGE_REGION: 'eu-central-1',
    });
    expect(await (service as any).s3Client.config.region()).toBe(
      'eu-central-1',
    );
  });

  it('does not build a client for a custom endpoint without a region, and says why', () => {
    const service = build({ STORAGE_ENDPOINT: 'http://minio:9000' });
    expect((service as any).s3Client).toBeNull();

    service.onModuleInit();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'STORAGE_REGION (required when STORAGE_ENDPOINT is set)',
      ),
    );
  });

  it('aborts startup for that misconfiguration when storage is required', () => {
    const service = build({
      STORAGE_ENDPOINT: 'http://minio:9000',
      STORAGE_REQUIRED: 'true',
    });
    expect(() => service.onModuleInit()).toThrow(/STORAGE_REGION/);
  });
});
