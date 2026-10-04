import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import ToastContainer from "./Toast";
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
