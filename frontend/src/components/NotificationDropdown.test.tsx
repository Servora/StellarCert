import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, describe, it, expect, beforeEach } from "vitest";
import NotificationDropdown from "./NotificationDropdown";
import { useNotifications } from "../context/NotificationContext";
import type { Notification } from "../api/types";

vi.mock("../context/NotificationContext", () => ({
  useNotifications: vi.fn(),
}));

const markAsRead = vi.fn();
const markAllAsRead = vi.fn();

const makeNotification = (overrides: Partial<Notification> = {}): Notification => ({
  id: "n1",
  type: "info",
  title: "Certificate issued",
  message: "Your certificate is ready",
  isRead: false,
  createdAt: new Date().toISOString(),
  ...overrides,
});

const mockNotifications = (notifications: Notification[]) => {
  vi.mocked(useNotifications).mockReturnValue({
    notifications,
    unreadCount: notifications.filter((n) => !n.isRead).length,
    markAsRead,
    markAllAsRead,
    refetchNotifications: vi.fn(),
  });
};

const renderDropdown = () =>
  render(
    <MemoryRouter>
      <NotificationDropdown />
    </MemoryRouter>,
  );

describe("NotificationDropdown toggle accessibility (#1326)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gives the bell button an accessible name and collapsed state", () => {
    mockNotifications([]);
    renderDropdown();

    const toggle = screen.getByRole("button", { name: "Notifications" });
    expect(toggle).toHaveAttribute("aria-haspopup", "dialog");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).not.toHaveAttribute("aria-controls");
  });

  it("includes the unread count in the accessible name", () => {
    mockNotifications([
      makeNotification({ id: "a" }),
      makeNotification({ id: "b" }),
      makeNotification({ id: "c", isRead: true }),
    ]);
    renderDropdown();

    expect(
      screen.getByRole("button", { name: "Notifications, 2 unread" }),
    ).toBeInTheDocument();
  });

  it("reflects the open state and points at the panel it controls", () => {
    mockNotifications([]);
    renderDropdown();

    const toggle = screen.getByRole("button", { name: "Notifications" });
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("dialog", { name: "Notifications" });
    expect(toggle).toHaveAttribute("aria-controls", panel.id);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
