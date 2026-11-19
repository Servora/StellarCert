import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import AccountSecurity from "../AccountSecurity";
import { useAuth } from "../../context/AuthContext";
import {
  listSessions,
  revokeAllSessions,
} from "../../api/endpoints";

vi.mock("../../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../api/endpoints", () => ({
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
  revokeAllSessions: vi.fn(),
}));

const clearAuth = vi.fn();

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/security"]}>
      <Routes>
        <Route path="/security" element={<AccountSecurity />} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe("AccountSecurity sign out everywhere (#1325)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      setUser: vi.fn(),
      isAuthenticated: true,
      isLoading: false,
      clearAuth,
      login: vi.fn(),
      logout: vi.fn(),
    } as never);
    vi.mocked(listSessions).mockResolvedValue([]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tears down auth state and routes to /login without a hard reload", async () => {
    vi.mocked(revokeAllSessions).mockResolvedValue({ revoked: 3 });
    renderPage();

    const button = await screen.findByRole("button", {
      name: /sign out everywhere/i,
    });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);

    expect(await screen.findByText("Login page")).toBeInTheDocument();
    expect(revokeAllSessions).toHaveBeenCalledTimes(1);
    expect(clearAuth).toHaveBeenCalledTimes(1);
    // The session list is not re-fetched with the now-revoked credentials.
    expect(listSessions).toHaveBeenCalledTimes(1);
  });

  it("stays on the page and keeps auth state when revoking fails", async () => {
    vi.mocked(revokeAllSessions).mockRejectedValue(new Error("Server down"));
    renderPage();

    const button = await screen.findByRole("button", {
      name: /sign out everywhere/i,
    });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);

    expect(await screen.findByRole("alert")).toHaveTextContent("Server down");
    expect(clearAuth).not.toHaveBeenCalled();
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
  });

  it("does nothing when the confirmation is cancelled", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    renderPage();

    const button = await screen.findByRole("button", {
      name: /sign out everywhere/i,
    });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);

    expect(revokeAllSessions).not.toHaveBeenCalled();
    expect(clearAuth).not.toHaveBeenCalled();
  });
});
