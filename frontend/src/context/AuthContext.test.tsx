import React from 'react';
import { screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AuthProvider,
  useAuth,
  decodeJwtPayload,
  isTokenExpired,
} from './AuthContext';
import { tokenStorage, notifyTokenRefreshed } from '../api/tokens';
import { authApi } from '../api/endpoints';
import { User, UserRole } from '../api/types';
import { createTestQueryClient } from '../test/renderWithProviders';
import { renderWithProviders } from '../test/renderWithProviders';

vi.mock('../api/endpoints', () => ({
  authApi: {
    bootstrapAuth: vi.fn().mockRejectedValue(new Error('No refresh cookie')),
    refresh: vi.fn().mockRejectedValue(new Error('No refresh cookie')),
  },
  userApi: {
    getProfile: vi.fn(),
  },
}));

/** Build a JWT-shaped token whose `exp` is `offsetSec` from now. */
const makeToken = (offsetSec: number): string => {
  const payload = btoa(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + offsetSec }),
  );
  return `header.${payload}.signature`;
};

const sampleUser: User = {
  id: '1',
  email: 'alice@example.com',
  firstName: 'Alice',
  lastName: 'Doe',
  role: UserRole.USER,
};

const Consumer: React.FC = () => {
  const { isAuthenticated, user } = useAuth();
  return (
    <div>
      <span data-testid="auth">{String(isAuthenticated)}</span>
      <span data-testid="user">{user?.email ?? 'none'}</span>
    </div>
  );
};

// AuthProvider mirrors the session user into the query cache, so it needs a
// QueryClientProvider above it — the same nesting the app uses in main.tsx.
const renderAuth = () =>
  renderWithProviders(
    <AuthProvider>
      <Consumer />
    </AuthProvider>,
    { queryClient: createTestQueryClient() },
  );

beforeEach(() => {
  tokenStorage.clearTokens();
});

describe('AuthContext silent token refresh (#560)', () => {
  it('flips isAuthenticated to true and sets the user after a silent refresh', async () => {
    // Start unauthenticated (no token, no user).
    renderAuth();

    await act(async () => {
      // Allow initial rehydration promise to resolve
    });

    expect(screen.getByTestId('auth').textContent).toBe('false');
    expect(screen.getByTestId('user').textContent).toBe('none');

    // Simulate apiClient's background refresh writing a fresh token + user.
    act(() => {
      tokenStorage.setAccessToken(makeToken(3600));
      notifyTokenRefreshed(makeToken(3600), sampleUser);
    });

    // Context updates immediately — no waiting for the 5-minute expiry check.
    expect(screen.getByTestId('auth').textContent).toBe('true');
    expect(screen.getByTestId('user').textContent).toBe('alice@example.com');
  });

  it('updates the user object from the refresh response', async () => {
    tokenStorage.setAccessToken(makeToken(3600));

    renderAuth();

    await act(async () => {});

    act(() => {
      notifyTokenRefreshed(makeToken(3600), sampleUser);
    });

    expect(screen.getByTestId('user').textContent).toBe('alice@example.com');

    const updated: User = { ...sampleUser, email: 'alice.new@example.com' };
    act(() => {
      tokenStorage.setAccessToken(makeToken(3600));
      notifyTokenRefreshed(makeToken(3600), updated);
    });

    expect(screen.getByTestId('user').textContent).toBe('alice.new@example.com');
    expect(screen.getByTestId('auth').textContent).toBe('true');
  });

  it('keeps isAuthenticated false when a refresh carries no user', async () => {
    tokenStorage.setAccessToken(makeToken(-100)); // expired going in

    renderAuth();

    await act(async () => {});

    expect(screen.getByTestId('auth').textContent).toBe('false');

    act(() => {
      notifyTokenRefreshed(makeToken(3600));
    });
    expect(screen.getByTestId('auth').textContent).toBe('false');
  });

  it('ignores a refreshed token that is already expired', async () => {
    renderAuth();

    await act(async () => {});

    act(() => {
      notifyTokenRefreshed(makeToken(-100), sampleUser);
    });
    // Expired token must not authenticate.
    expect(screen.getByTestId('auth').textContent).toBe('false');
  });

  describe('JWT base64url decoding (#787)', () => {
    it('successfully decodes base64url payload containing - and _ without padding', () => {
      // payload with binary/uuid data that produces - and _ in base64url
      // {"sub":"user-123_abc","exp":2000000000}
      // JSON base64: eyJzdWIiOiJ1c2VyLTEyM19hYmMiLCJleHAiOjIwMDAwMDAwMDB9
      // Base64url with characters - and _:
      const obj = { sub: 'user-xyz_123', exp: 2000000000, name: 'Alice ?' };
      const json = JSON.stringify(obj);
      // Construct a raw base64url string with '-' and '_'
      const base64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const token = `header.${base64}.sig`;

      const payload = decodeJwtPayload(token);
      expect(payload).toEqual(obj);
      expect(isTokenExpired(token)).toBe(false);
    });

    it('considers expired base64url tokens as expired', () => {
      const obj = { sub: 'user-xyz_123', exp: 100000 };
      const json = JSON.stringify(obj);
      const base64url = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const token = `header.${base64url}.sig`;

      expect(isTokenExpired(token)).toBe(true);
    });

    it('handles malformed tokens safely without throwing', () => {
      expect(isTokenExpired('')).toBe(true);
      expect(isTokenExpired('not-a-token')).toBe(true);
      expect(isTokenExpired('header.invalid-base64-payload!!!.sig')).toBe(true);
    });
  });
});


describe('AuthContext bootstrap on page load (#960)', () => {
  it('restores an authenticated session from bootstrapAuth', async () => {
    const token = makeToken(3600);
    vi.mocked(authApi.bootstrapAuth).mockResolvedValueOnce({
      accessToken: token,
      user: sampleUser,
    } as never);

    renderAuth();

    expect(screen.queryByTestId('auth')).toBeNull();

    await act(async () => {});

    expect(screen.getByTestId('auth').textContent).toBe('true');
    expect(screen.getByTestId('user').textContent).toBe('alice@example.com');
  });

  it('starts unauthenticated when bootstrapAuth rejects', async () => {
    renderAuth();

    await act(async () => {});

    expect(screen.getByTestId('auth').textContent).toBe('false');
    expect(screen.getByTestId('user').textContent).toBe('none');
  });

  it('rejects an already-expired bootstrap token', async () => {
    vi.mocked(authApi.bootstrapAuth).mockResolvedValueOnce({
      accessToken: makeToken(-60),
      user: sampleUser,
    } as never);

    renderAuth();

    await act(async () => {});

    expect(screen.getByTestId('auth').textContent).toBe('false');
  });
});
