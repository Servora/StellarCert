import React from "react";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createTestQueryClient, renderWithProviders } from "./test/renderWithProviders";

// Keep providers/chrome light so the assertions are about routing + error
// containment only (same approach as App.routing.test.tsx).
vi.mock("./context/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: null,
    setUser: vi.fn(),
    isAuthenticated: false,
    isLoading: false,
    clearAuth: vi.fn(),
    login: vi.fn(),
  }),
}));
vi.mock("./context/NotificationContext", () => ({
  NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("./components/Header", () => ({ default: () => null }));
vi.mock("./components/Toast", () => ({ default: () => null }));

// Represents a lazy page chunk that fails to evaluate — the shape of the #744
// bug: `import("./pages/NotFound")` resolving on a case-insensitive dev machine
// and failing on Linux/CI, which surfaced as a blank screen instead of a 404.
vi.mock("./pages/Dashboard", () => ({
  default: () => {
    throw new Error(
      "Failed to fetch dynamically imported module: /assets/Dashboard-abc123.js",
    );
  },
}));

// Routed pages read server state through the query layer, so the tree needs a
// QueryClient in place. It is created per render so a cached entry from one
// test cannot satisfy the next.
const renderAt = (path: string) =>
  renderWithProviders(<App />, {
    queryClient: createTestQueryClient(),
    routerEntries: [path],
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App route error handling (#744)", () => {
  it("renders the 404 page for an unknown path instead of a blank screen", async () => {
    renderAt("/definitely-not-a-route");

    expect(await screen.findByText("Page Not Found")).toBeInTheDocument();
    expect(screen.getByText("Error 404")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Back to Dashboard/i }),
    ).toBeInTheDocument();
  });

  it("contains a page that fails to load instead of blanking the app", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    renderAt("/");

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("resets error boundary on route change", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    // First render a failing page
    renderAt("/");

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();

    // Navigate to a different route (should reset the error boundary)
    renderAt("/verify");

    // Should now show the Verify page content instead of error
    expect(await screen.findByText("Verify Certificate")).toBeInTheDocument();
  });
});
