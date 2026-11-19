import type { User } from './types';

/**
 * Callback invoked after `apiClient` silently refreshes the access token, so
 * AuthContext can keep its reactive `isAuthenticated` / `user` state in sync.
 * The fresh `user` from the refresh response is forwarded when available.
 */
export type TokenRefreshCallback = (accessToken: string, user?: User | null) => void;

const _tokenRefreshSubscribers = new Set<TokenRefreshCallback>();

export const subscribeTokenRefresh = (cb: TokenRefreshCallback): (() => void) => {
  _tokenRefreshSubscribers.add(cb);
  return () => {
    _tokenRefreshSubscribers.delete(cb);
  };
};

export const setTokenRefreshCallback = (cb: TokenRefreshCallback) => {
  _tokenRefreshSubscribers.clear();
  _tokenRefreshSubscribers.add(cb);
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
