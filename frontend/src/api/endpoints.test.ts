import { vi } from 'vitest';
import * as endpoints from './endpoints';
import { tokenStorage } from './tokens';

describe('frontend api endpoints', () => {
  it('does not expose a runtime toggleDummyData helper', () => {
    expect((endpoints as Record<string, unknown>).toggleDummyData).toBeUndefined();
  });

  it('fetches certificate history and maps audit log items to ActivityItem', async () => {
    const mockResponse = [
      {
        id: 'audit-1',
        action: 'Certificate verified',
        description: 'Verified certificate',
        timestamp: Date.now().toString(),
      },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    }) as unknown as typeof global.fetch;

    const history = await endpoints.auditApi.getCertificateHistory('cert-1');

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      type: 'verify',
      description: 'Verified certificate',
    });
  });

  it('uses the refreshed access token when retrying after a 401', async () => {
    tokenStorage.setAccessToken('expired-token');
    const refreshedUser = {
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      role: 'issuer',
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Unauthorized', statusCode: 401 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ accessToken: 'fresh-token', user: refreshedUser }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: 'success' }),
      });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    await expect(endpoints.apiClient('/protected')).resolves.toEqual({ result: 'success' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][1]?.headers).toBeInstanceOf(Headers);
    expect((fetchMock.mock.calls[2][1]?.headers as Headers).get('Authorization'))
      .toBe('Bearer fresh-token');
  });

  it('encodes reserved characters in certificate serial numbers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ isValid: true }),
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    await endpoints.verifyCertificate('serial /?#');

    expect(fetchMock.mock.calls[0][0]).toContain(
      '/certificates/verify/serial%20%2F%3F%23',
    );
  });
});
