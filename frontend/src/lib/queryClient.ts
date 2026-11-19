import { QueryClient } from "@tanstack/react-query";
import type { ApiError } from "../api/types";

/**
 * How long fetched server state is considered fresh. While data is fresh,
 * remounting a route (or adding a second component that needs the same
 * resource) is served from the cache instead of hitting the network.
 */
export const DEFAULT_STALE_TIME = 30_000;

/** Unused cache entries are dropped after 5 minutes. */
const CACHE_TIME = 5 * 60_000;

/** Two retries, i.e. three attempts in total. */
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY = 300;
const MAX_RETRY_DELAY = 2_000;

const isRetryableError = (error: unknown): boolean => {
  const status = (error as ApiError | undefined)?.statusCode;

  // No status code at all means a transport-level failure (offline, DNS, CORS
  // preflight, aborted) — worth another attempt.
  if (typeof status !== "number") return true;

  // Client errors are deterministic; retrying only delays the error surfacing.
  if (status >= 400 && status < 500) return false;

  return true;
};

/**
 * Builds the app-wide QueryClient. Retry, backoff and staleness are configured
 * here rather than in `apiClient`, so `endpoints.ts` stays a plain fetcher.
 */
export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME,
        gcTime: CACHE_TIME,
        retry: (failureCount, error) =>
          failureCount < MAX_RETRIES && isRetryableError(error),
        retryDelay: (attemptIndex) =>
          Math.min(RETRY_BASE_DELAY * 2 ** attemptIndex, MAX_RETRY_DELAY),
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: false,
      },
    },
  });

/** The client used by the running app. Tests build their own via `createQueryClient`. */
export const queryClient = createQueryClient();
