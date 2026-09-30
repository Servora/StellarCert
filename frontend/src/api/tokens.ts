import type { User } from './types';

/**
 * Callback invoked after `apiClient` silently refreshes the access token, so
 * AuthContext can keep its reactive `isAuthenticated` / `user` state in sync.
 * The fresh `user` from the refresh response is forwarded when available.
 */
type TokenRefreshCallback = (accessToken: string, user?: User | null) => void;

let _onTokenRefreshed: TokenRefreshCallback | null = null;
export const setTokenRefreshCallback = (cb: TokenRefreshCallback) => {
  _onTokenRefreshed = cb;
};
export const notifyTokenRefreshed = (accessToken: string, user?: User | null) => {
  _onTokenRefreshed?.(accessToken, user);
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
