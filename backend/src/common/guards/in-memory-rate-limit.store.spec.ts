import { InMemoryRateLimitStore } from './ip-rate-limit.guard';

describe('InMemoryRateLimitStore', () => {
  it('counts within a window and restarts after it', async () => {
    const store = new InMemoryRateLimitStore();

    expect((await store.consume('k', 1_000, 0)).count).toBe(1);
    expect((await store.consume('k', 1_000, 500)).count).toBe(2);
    expect((await store.consume('k', 1_000, 1_001)).count).toBe(1);
  });

  it('sweeps expired counters so the map cannot grow without bound', async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < 1_000; i += 1) {
      await store.consume(`ip-${i}`, 1_000, 0);
    }
    expect(
      (store as unknown as { entries: Map<string, unknown> }).entries.size,
    ).toBe(1_000);

    // A request after the sweep interval drops everything that has expired.
    await store.consume('fresh', 1_000, 120_000);

    expect(
      (store as unknown as { entries: Map<string, unknown> }).entries.size,
    ).toBe(1);
  });
});
