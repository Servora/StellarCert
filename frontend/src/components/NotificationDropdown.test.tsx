import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

describe("NotificationDropdown link-through (#1327)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderWithRoutes = () =>
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<NotificationDropdown />} />
          <Route path="/wallet" element={<div>Wallet page</div>} />
        </Routes>
      </MemoryRouter>,
    );

  it("navigates to the linked resource, marks it read and closes the panel", () => {
    mockNotifications([
      makeNotification({ id: "n1", title: "Transfer received", link: "/wallet" }),
    ]);
    renderWithRoutes();

    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    const link = screen.getByRole("link", { name: /transfer received/i });
    expect(link).toHaveAttribute("href", "/wallet");

    fireEvent.click(link);

    expect(markAsRead).toHaveBeenCalledWith("n1");
    expect(screen.getByText("Wallet page")).toBeInTheDocument();
  });

  it("does not mark an already-read notification again", () => {
    mockNotifications([
      makeNotification({ id: "n1", title: "Transfer received", link: "/wallet", isRead: true }),
    ]);
    renderWithRoutes();

    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    fireEvent.click(screen.getByRole("link", { name: /transfer received/i }));

    expect(markAsRead).not.toHaveBeenCalled();
    expect(screen.getByText("Wallet page")).toBeInTheDocument();
  });

  it("renders a plain row when the notification has no link", () => {
    mockNotifications([makeNotification({ title: "System notice" })]);
    renderDropdown();

    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));

    expect(screen.getByText("System notice")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /system notice/i }),
    ).not.toBeInTheDocument();
  });

  it.each(["https://evil.example/phish", "//evil.example", "/not-a-route"])(
    "ignores an unsafe or unknown link (%s)",
    (link) => {
      mockNotifications([makeNotification({ title: "Suspicious", link })]);
      renderDropdown();

      fireEvent.click(screen.getByRole("button", { name: /notifications/i }));

      expect(
        screen.queryByRole("link", { name: /suspicious/i }),
      ).not.toBeInTheDocument();
    },
  );

  it("keeps the mark-as-read button separate from the link", () => {
    mockNotifications([
      makeNotification({ id: "n1", title: "Transfer received", link: "/wallet" }),
    ]);
    renderWithRoutes();

    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    fireEvent.click(
      screen.getByRole("button", { name: "Mark Transfer received as read" }),
    );

    expect(markAsRead).toHaveBeenCalledWith("n1");
    expect(screen.queryByText("Wallet page")).not.toBeInTheDocument();
  });
});
