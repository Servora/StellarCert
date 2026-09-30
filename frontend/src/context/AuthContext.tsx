import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { User } from '../api/types';
import { tokenStorage, setTokenRefreshCallback } from '../api/tokens';
import { authApi } from '../api/endpoints';
import { queryKeys } from '../api/queries';

// Helper function to decode JWT payload safely (handling base64url characters - and _ and missing padding)
export const decodeJwtPayload = (token: string): any => {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('Invalid JWT format');
  }
  let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (base64.length % 4)) % 4;
  base64 += '='.repeat(padLength);

  let jsonStr: string;
  try {
    jsonStr = decodeURIComponent(
      Array.prototype.map
        .call(
          atob(base64),
          (c: string) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2),
        )
        .join(''),
    );
  } catch {
    jsonStr = atob(base64);
  }

  return JSON.parse(jsonStr);
};

// Helper function to check if JWT token is expired
export const isTokenExpired = (token: string): boolean => {
  try {
    const payload = decodeJwtPayload(token);
    if (!payload || typeof payload.exp !== 'number') {
      return true;
    }
    const currentTime = Date.now() / 1000;
    return payload.exp < currentTime;
  } catch {
    return true; // If token is malformed, consider it expired
  }
};

interface AuthContextValue {
  user: User | null;
  setUser: (user: User | null) => void;
  isAuthenticated: boolean;
  isLoading: boolean;
  clearAuth: () => void;
  login: (accessToken: string, user: User) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUserState] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  // Track the access token in React state so `isAuthenticated` is reactive.
  const [accessToken, setAccessTokenState] = useState<string | null>(() =>
    tokenStorage.getAccessToken(),
  );
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // The session user is mirrored into the query cache under `queryKeys.session()`
  // so components that read the profile (header, issuer profile page) share one
  // entry instead of each issuing their own /users/profile request.
  const setUser = useCallback(
    (nextUser: User | null) => {
      setUserState(nextUser);
      if (nextUser) {
        queryClient.setQueryData(queryKeys.session(), nextUser);
      }
    },
    [queryClient],
  );

  // Derive isAuthenticated once per token/user change.
  const isAuthenticated = useMemo(() => {
    return !!user && !!accessToken && !isTokenExpired(accessToken);
  }, [user, accessToken]);

  // Logout must not leave the previous user's data in the cache: every list,
  // wallet and analytics entry is keyed to the account that fetched it.
  const clearAuth = useCallback(() => {
    setUserState(null);
    tokenStorage.clearTokens();
    setAccessTokenState(null);
    queryClient.clear();
  }, [queryClient]);

  const login = useCallback(
    (nextAccessToken: string, nextUser: User) => {
      if (isTokenExpired(nextAccessToken)) {
        console.error('Attempted to login with expired token');
        return;
      }

      // Access token is held in-memory in tokenStorage
      tokenStorage.setAccessToken(nextAccessToken);
      setAccessTokenState(nextAccessToken);
      setUser(nextUser);
    },
    [setUser],
  );

  useEffect(() => {
    /**
     * Bootstrap authentication before rendering any application routes.
     *
     * The access token intentionally lives only in memory, so a full page load
     * cannot reuse it. One explicit refresh establishes the session from the
     * HttpOnly refresh-token cookie. AuthProvider keeps isLoading=true until
     * this finishes, preventing protected components from issuing 401s during
     * startup and eliminating the refresh burst/cooldown workaround.
     */
    const bootstrap = async () => {
      try {
        const response = await authApi.bootstrapAuth();

        if (response.accessToken && !isTokenExpired(response.accessToken)) {
          tokenStorage.setAccessToken(response.accessToken);
          setAccessTokenState(response.accessToken);
          if (response.user) {
            setUser(response.user);
          }
        } else {
          tokenStorage.clearTokens();
          setUser(null);
          setAccessTokenState(null);
        }
      } catch {
        // No valid refresh cookie means the app starts unauthenticated.
        tokenStorage.clearTokens();
        setUser(null);
        setAccessTokenState(null);
      } finally {
        setIsLoading(false);
      }
    };

    bootstrap();

    // Keep AuthContext in sync when apiClient silently refreshes the access token.
    setTokenRefreshCallback((newAccessToken, refreshedUser) => {
      if (isTokenExpired(newAccessToken)) {
        return;
      }
      setAccessTokenState(newAccessToken);
      if (refreshedUser) {
        setUser(refreshedUser);
      }
      setIsLoading(false);
    });

    // Set up periodic token expiration check (every 5 minutes)
    const interval = setInterval(() => {
      const currentToken = tokenStorage.getAccessToken();
      if (currentToken && isTokenExpired(currentToken)) {
        console.warn('Access token expired, clearing authentication state');
        tokenStorage.clearTokens();
        clearAuth();
      }
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(interval);
      setTokenRefreshCallback(() => {});
    };
    // `clearAuth` is stable; `setUser` changes only with the QueryClient.
  }, [clearAuth, setUser]);

  useEffect(() => {
    if (!user) {
      tokenStorage.clearTokens();
      setAccessTokenState(null);
    }
  }, [user]);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      clearAuth();
      navigate('/');
    }
  }, [navigate, clearAuth]);
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        setUser,
        isAuthenticated,
        isLoading,
        clearAuth,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
