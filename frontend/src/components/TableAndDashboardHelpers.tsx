// Role-based dashboard code splitting and a refetch overlay for tables. Closes #1337, #1338.
import React, { Suspense, lazy } from "react";

type RoleDashboardProps = Record<string, unknown>;
type Loader = () => Promise<{
  default: React.ComponentType<RoleDashboardProps>;
}>;

// Each role gets its own lazy chunk; only the matching role's code is downloaded.
// Usage: createRoleDashboard({ issuer: () => import('./IssuerDashboard'), ... })
export function createRoleDashboard(
  loaders: Record<string, Loader>,
  fallback: React.ReactNode = <div>Loading…</div>,
) {
  const lazyByRole: Record<
    string,
    React.LazyExoticComponent<React.ComponentType<RoleDashboardProps>>
  > = {};
  Object.entries(loaders).forEach(([role, load]) => {
    lazyByRole[role] = lazy(load);
  });

  return function RoleDashboard({
    role,
    ...props
  }: { role: string } & RoleDashboardProps) {
    const Dashboard = lazyByRole[role];
    if (!Dashboard) return <p>No dashboard available for this role.</p>;
    return (
      <Suspense fallback={fallback}>
        <Dashboard {...props} />
      </Suspense>
    );
  };
}

// Keeps existing rows visible and dimmed while refetching (e.g. after a search keystroke).
// Use the full-page spinner only when there is no data yet (isPending && !data).
export const RefetchOverlay: React.FC<{
  isFetching: boolean;
  children: React.ReactNode;
}> = ({ isFetching, children }) => (
  <div className="relative" aria-busy={isFetching}>
    <div
      className={
        isFetching ? "opacity-60 transition-opacity" : "transition-opacity"
      }
    >
      {children}
    </div>
    {isFetching && (
      <span
        role="status"
        className="absolute right-2 top-2 text-xs text-gray-500"
      >
        Updating…
      </span>
    )}
  </div>
);
