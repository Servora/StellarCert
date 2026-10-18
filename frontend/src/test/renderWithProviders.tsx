import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * A QueryClient for tests.
 *
 * Retries are off so a rejected request surfaces as a single attempt rather than
 * three, and the cache is empty by default so each test starts from a known
 * state. `staleTime: 0` keeps the default refetch-on-mount behaviour, which is
 * what the dedup tests below rely on: a remount only reuses the cache if the
 * entry is still fresh.
 */
export const createTestQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

export interface ProviderOptions extends Omit<RenderOptions, 'wrapper'> {
  queryClient?: QueryClient;
  /** Initial entries for the router; pass one per route under test. */
  routerEntries?: string[];
  /** Extra providers wrapped inside the router, e.g. a mocked auth context. */
  wrapper?: ReactNode;
}

export interface ProviderRenderResult extends RenderResult {
  queryClient: QueryClient;
}

/**
 * Renders `ui` inside a QueryClientProvider (and a MemoryRouter, since most
 * migrated pages read route params or query strings).
 *
 * Pass an explicit `queryClient` to share one cache across two renders - that is
 * the whole point of the issue this migration fixes, so it needs to be reachable
 * from the test.
 */
export const renderWithProviders = (
  ui: ReactElement,
  {
    queryClient = createTestQueryClient(),
    routerEntries = ['/'],
    wrapper,
    ...renderOptions
  }: ProviderOptions = {},
): ProviderRenderResult => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={routerEntries}>{children}</MemoryRouter>
    </QueryClientProvider>
  );

  // `wrapper` slots in below the router so a test-provided provider (a mocked
  // auth context, for instance) is inside the same React tree as the page.
  const WrapperWithExtras = ({ children }: { children: ReactNode }) => (
    <Wrapper>
      {wrapper}
      {children}
    </Wrapper>
  );

  return {
    ...render(ui, {
      wrapper: wrapper ? WrapperWithExtras : Wrapper,
      ...renderOptions,
    }),
    queryClient,
  };
};

export default renderWithProviders;
