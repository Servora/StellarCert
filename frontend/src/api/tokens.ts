import type { User } from './types';

/**
 * Callback invoked after `apiClient` silently refreshes the access token, so
 * AuthContext can keep its reactive `isAuthenticated` / `user` state in sync.
 * The fresh `user` from the refresh response is forwarded when available.
 */
export type TokenRefreshCallback = (accessToken: string, user?: User | null) => void;

const _tokenRefreshSubscribers = new Set<TokenRefreshCallback>();

/**
 * Registers a token-refresh listener and returns its unsubscribe function.
 *
 * This is the only way to listen for refreshes. Several consumers subscribe at
 * once (AuthContext and NotificationContext), so registration must be
 * additive: there is deliberately no "replace all listeners" setter, because
 * one would silently drop the others' subscriptions (#1329).
 */
export const subscribeTokenRefresh = (cb: TokenRefreshCallback): (() => void) => {
  _tokenRefreshSubscribers.add(cb);
  return () => {
    _tokenRefreshSubscribers.delete(cb);
  };
};

export const notifyTokenRefreshed = (accessToken: string, user?: User | null) => {
  _tokenRefreshSubscribers.forEach((cb) => {
    try {
      cb(accessToken, user);
    } catch (err) {
      console.error('Error in token refresh callback:', err);
    }
  });
};

let _inMemoryAccessToken: string | null = null;

export const tokenStorage = {
  getAccessToken: (): string | null => _inMemoryAccessToken,
  setAccessToken: (token: string): void => {
    _inMemoryAccessToken = token;
  },
  clearTokens: (): void => {
    _inMemoryAccessToken = null;
  },
  hasAccessToken: (): boolean => !!_inMemoryAccessToken,
};
