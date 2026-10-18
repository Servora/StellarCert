import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('checks the database, Stellar, and Redis in the primary health check', async () => {
    const databaseHealth = { isHealthy: jest.fn().mockResolvedValue({}) };
    const stellarHealth = { isHealthy: jest.fn().mockResolvedValue({}) };
    const redisHealth = { isHealthy: jest.fn().mockResolvedValue({}) };
    const health = {
      check: jest.fn(async (indicators: Array<() => Promise<unknown>>) => {
        await Promise.all(indicators.map((indicator) => indicator()));
        return { status: 'ok' };
      }),
    };
    const logger = { error: jest.fn() };
    const controller = new HealthController(
      health as never,
      databaseHealth as never,
      stellarHealth as never,
      redisHealth as never,
      logger as never,
    );

    await controller.check();

    expect(databaseHealth.isHealthy).toHaveBeenCalledTimes(1);
    expect(stellarHealth.isHealthy).toHaveBeenCalledTimes(1);
    expect(redisHealth.isHealthy).toHaveBeenCalledTimes(1);
  });
});