import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import Header from "./Header";
import { useAuth } from "../context/AuthContext";
import { UserRole } from "../api/types";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("./NotificationDropdown", () => ({
  default: () => <div>Notifications</div>,
}));

vi.mock("./ThemeToggle", () => ({
  default: () => <button type="button">Theme</button>,
}));

describe("Header mobile navigation", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      setUser: vi.fn(),
      isAuthenticated: false,
      isLoading: false,
      clearAuth: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
    } as never);
  });

  it("opens and closes a slide-out mobile navigation drawer", () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );

    const menuButton = screen.getByRole("button", {
      name: /open navigation menu/i,
    });
    expect(menuButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(menuButton);

    expect(menuButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Menu")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /close navigation menu/i }),
    );

    expect(menuButton).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Header wallet link visibility", () => {
  const renderAs = (role: UserRole | null) => {
    vi.mocked(useAuth).mockReturnValue({
      user: role ? ({ id: "u1", email: "u@example.com", role } as never) : null,
      setUser: vi.fn(),
      isAuthenticated: Boolean(role),
      isLoading: false,
      clearAuth: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
    } as never);

    return render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );
  };

  const walletLinks = () => screen.queryAllByRole("link", { name: "Wallet" });

  it.each([
    UserRole.RECIPIENT,
    UserRole.VERIFIER,
    UserRole.ISSUER,
    UserRole.ADMIN,
  ])("shows the Wallet link to %s", (role) => {
    renderAs(role);

    expect(walletLinks().length).toBeGreaterThan(0);
  });

  // A freshly registered USER used to see a Wallet link that the route
  // rejected, redirecting them back to `/` with no explanation.
  it.each([UserRole.USER, UserRole.AUDITOR])(
    "hides the Wallet link from %s, whose route access is denied",
    (role) => {
      renderAs(role);

      expect(walletLinks()).toHaveLength(0);
    },
  );

  it("hides the Wallet link from signed-out visitors", () => {
    renderAs(null);

    expect(walletLinks()).toHaveLength(0);
  });

  it("still points the link at /wallet", () => {
    renderAs(UserRole.RECIPIENT);

    expect(walletLinks()[0]).toHaveAttribute("href", "/wallet");
  });

  it("keeps the issuer nav in its original order", () => {
    renderAs(UserRole.ISSUER);

    const labels = screen
      .getAllByRole("link")
      .map((link) => link.textContent?.trim())
      .filter((label): label is string => Boolean(label));

    expect(labels.filter((label) => label === "Issue")).not.toHaveLength(0);
    const first = labels.indexOf("Issue");
    expect(labels.slice(first, first + 4)).toEqual([
      "Issue",
      "Revoke",
      "Wallet",
      "Certificates",
    ]);
  });

  it("leaves the other nav items alone for a USER", () => {
    renderAs(UserRole.USER);

    expect(
      screen.queryAllByRole("link", { name: "Dashboard" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryAllByRole("link", { name: "Verify" }).length,
    ).toBeGreaterThan(0);
  });
});

describe("Header authentication controls (#997)", () => {
  const renderAs = (role: UserRole | null) => {
    vi.mocked(useAuth).mockReturnValue({
      user: role ? ({ id: "u1", email: "u@example.com", role } as never) : null,
      setUser: vi.fn(),
      isAuthenticated: Boolean(role),
      isLoading: false,
      clearAuth: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
    } as never);

    return render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );
  };

  it('shows "Sign in" link for logged-out users in desktop nav', () => {
    renderAs(null);

    const signInLink = screen.getByRole("link", { name: /sign in/i });
    expect(signInLink).toHaveAttribute("href", "/login");
  });

  it('shows "Sign in" link for logged-out users in mobile nav', () => {
    renderAs(null);

    // Open mobile drawer
    fireEvent.click(
      screen.getByRole("button", { name: /open navigation menu/i }),
    );

    // The desktop nav renders its own "Sign in" link, so scope the query to the
    // drawer - otherwise this matches both and the query is ambiguous.
    const drawer = within(document.getElementById("mobile-navigation-drawer")!);
    const signInLink = drawer.getByRole("link", { name: /sign in/i });
    expect(signInLink).toHaveAttribute("href", "/login");
  });

  it('shows "Sign out" button for logged-in users in desktop nav', () => {
    renderAs(UserRole.USER);

    const signOutButton = screen.getByRole("button", { name: /sign out/i });
    expect(signOutButton).toBeInTheDocument();
  });

  it('shows "Sign out" button for logged-in users in mobile nav', () => {
    renderAs(UserRole.USER);

    // Open mobile drawer
    fireEvent.click(
      screen.getByRole("button", { name: /open navigation menu/i }),
    );

    // Scope to the drawer: the desktop nav also renders a "Sign out" button.
    const drawer = within(document.getElementById("mobile-navigation-drawer")!);
    expect(
      drawer.getByRole("button", { name: /sign out/i }),
    ).toBeInTheDocument();
  });

  it("calls logout and navigates on Sign out click", async () => {
    const logoutMock = vi.fn();
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "u1", email: "u@example.com", role: UserRole.USER } as never,
      setUser: vi.fn(),
      isAuthenticated: true,
      isLoading: false,
      clearAuth: vi.fn(),
      login: vi.fn(),
      logout: logoutMock,
    } as never);

    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    expect(logoutMock).toHaveBeenCalled();
  });
});
