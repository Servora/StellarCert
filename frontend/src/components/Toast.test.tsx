import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import ToastContainer, {
  MAX_DISMISSED_TOAST_IDS,
  TOAST_RECENT_WINDOW_MS,
  pruneDismissedIds,
} from "./Toast";
import { NotificationProvider } from "../context/NotificationContext";

// Mock timers
vi.useFakeTimers();

const mockNotifications = [
  {
    id: "1",
    type: "success" as const,
    title: "Success",
    message: "Operation completed",
    isRead: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: "2",
    type: "error" as const,
    title: "Error",
    message: "Something went wrong",
    isRead: false,
    createdAt: new Date().toISOString(),
  },
];

const renderToast = () => {
  return render(
    <NotificationProvider>
      <ToastContainer />
    </NotificationProvider>,
  );
};

// Mock the NotificationContext
// The real NotificationProvider reads useAuth, so rendering it here would need
// an AuthProvider (and with it a router, a query client and a mocked bootstrap
// request) purely to satisfy a provider whose hook this test already replaces.
// Stubbing the provider to a passthrough keeps the test about ToastContainer.
vi.mock("../context/NotificationContext", async () => {
  const actual = await vi.importActual("../context/NotificationContext");
  return {
    ...actual,
    NotificationProvider: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    useNotifications: () => ({
      notifications: mockNotifications,
    }),
  };
});

describe("Toast auto-dismiss and accessibility (#1000)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    // ToastContainer only renders notifications newer than 10s. The fake clock
    // advances across tests, so timestamps fixed at module load fall outside
    // that window and every toast silently disappears. Re-stamp them once per
    // test - not per render, or the re-render would re-add a dismissed toast.
    const now = new Date().toISOString();
    mockNotifications.forEach((n) => {
      n.createdAt = now;
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useFakeTimers();
  });

  it('renders toast with role="status" and aria-live="polite"', () => {
    renderToast();

    const container = screen.getByRole("status");
    expect(container).toHaveAttribute("aria-live", "polite");
    expect(container).toHaveAttribute("aria-label", "Notifications");
  });

  it("shows toast notifications", () => {
    renderToast();

    expect(screen.getByText("Success")).toBeInTheDocument();
    expect(screen.getByText("Operation completed")).toBeInTheDocument();
  });

  it("auto-dismisses toast after 5 seconds", () => {
    renderToast();

    expect(screen.getByText("Success")).toBeInTheDocument();

    // Advance timers by 5 seconds
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText("Success")).not.toBeInTheDocument();
  });

  it("close button has aria-label", () => {
    renderToast();

    const closeButton = screen.getByRole("button", {
      name: /dismiss success notification/i,
    });
    expect(closeButton).toBeInTheDocument();
  });

  it("manual close removes toast", () => {
    renderToast();

    expect(screen.getByText("Success")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /dismiss success notification/i }),
    );

    expect(screen.queryByText("Success")).not.toBeInTheDocument();
  });
});

describe("pruneDismissedIds (#1328)", () => {
  const NOW = Date.parse("2026-01-01T00:00:00.000Z");
  const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
  const notification = (id: string, msAgo: number) => ({
    id,
    type: "info" as const,
    title: id,
    message: id,
    isRead: false,
    createdAt: at(msAgo),
  });

  it("keeps dismissals for notifications still inside the recent window", () => {
    const dismissed = new Set(["fresh"]);
    pruneDismissedIds(dismissed, [notification("fresh", 1000)], NOW);
    expect([...dismissed]).toEqual(["fresh"]);
  });

  it("drops dismissals whose notification aged out of the recent window", () => {
    const dismissed = new Set(["old", "fresh"]);
    pruneDismissedIds(
      dismissed,
      [
        notification("old", TOAST_RECENT_WINDOW_MS + 1),
        notification("fresh", 1000),
      ],
      NOW,
    );
    expect([...dismissed]).toEqual(["fresh"]);
  });

  it("drops dismissals whose notification is no longer in the list", () => {
    const dismissed = new Set(["gone"]);
    pruneDismissedIds(dismissed, [], NOW);
    expect(dismissed.size).toBe(0);
  });

  it("caps the set, evicting the oldest dismissals first", () => {
    const total = MAX_DISMISSED_TOAST_IDS + 5;
    const ids = Array.from({ length: total }, (_, i) => `n${i}`);
    const dismissed = new Set(ids);
    pruneDismissedIds(
      dismissed,
      ids.map((id) => notification(id, 0)),
      NOW,
    );
    expect(dismissed.size).toBe(MAX_DISMISSED_TOAST_IDS);
    expect(dismissed.has("n0")).toBe(false);
    expect(dismissed.has(`n${total - 1}`)).toBe(true);
  });
});
