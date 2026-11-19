import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import UserManagement from "./UserManagement";
import { auditApi, userApi } from "../../../api/endpoints";
import { UserRole, type User } from "../../../api/types";
import { renderWithProviders } from "../../../test/renderWithProviders";

vi.mock("../../../api/endpoints", () => ({
  userApi: {
    getAll: vi.fn(),
    updateRole: vi.fn(),
    toggleStatus: vi.fn(),
    delete: vi.fn(),
  },
  auditApi: {
    searchLogs: vi.fn(),
  },
}));

const makeUser = (n: number): User =>
  ({
    id: `u${n}`,
    email: `user${n}@example.com`,
    firstName: "User",
    lastName: String(n),
    role: UserRole.ISSUER,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }) as User;

// Mirrors GET /users: `{ data, meta: { total, page, limit, totalPages } }`.
const serverPage = (page: number, limit: number, total: number) => {
  const start = (page - 1) * limit;
  const count = Math.max(0, Math.min(limit, total - start));
  return {
    data: Array.from({ length: count }, (_, i) => makeUser(start + i + 1)),
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPreviousPage: page > 1,
    },
  };
};

const lastParams = () =>
  vi.mocked(userApi.getAll).mock.calls.at(-1)?.[0] as Record<string, unknown>;

describe("UserManagement pagination (#1323)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userApi.getAll).mockImplementation(async (params) => {
      const page = Number(params?.page ?? 1);
      const limit = Number(params?.limit ?? 10);
      return serverPage(page, limit, 25) as never;
    });
  });

  it("requests a bounded first page and renders only that page", async () => {
    renderWithProviders(<UserManagement />);

    expect(await screen.findByText("user1@example.com")).toBeInTheDocument();
    expect(lastParams()).toMatchObject({ page: 1, limit: 10 });
    expect(screen.getAllByRole("row")).toHaveLength(11); // header + 10 rows
    expect(screen.getByText("25 users")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(
      screen.getByText("Showing 1 to 10 of 25 results"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });

  it("moves between pages with the page controls", async () => {
    renderWithProviders(<UserManagement />);
    await screen.findByText("user1@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("user11@example.com")).toBeInTheDocument();
    expect(lastParams()).toMatchObject({ page: 2, limit: 10 });

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("user21@example.com")).toBeInTheDocument();
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(await screen.findByText("user11@example.com")).toBeInTheDocument();
  });

  it("changing the page size goes back to the first page", async () => {
    renderWithProviders(<UserManagement />);
    await screen.findByText("user1@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("user11@example.com");

    fireEvent.change(screen.getByLabelText("Users per page"), {
      target: { value: "25" },
    });

    await waitFor(() =>
      expect(lastParams()).toMatchObject({ page: 1, limit: 25 }),
    );
    expect(await screen.findByText("Page 1 of 1")).toBeInTheDocument();
  });

  it("changing a filter goes back to the first page", async () => {
    renderWithProviders(<UserManagement />);
    await screen.findByText("user1@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("user11@example.com");

    fireEvent.change(screen.getByDisplayValue("All Roles"), {
      target: { value: "issuer" },
    });

    await waitFor(() =>
      expect(lastParams()).toMatchObject({ page: 1, limit: 10, role: "issuer" }),
    );
  });
});

describe("UserManagement activity history (#1322)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userApi.getAll).mockResolvedValue(serverPage(1, 10, 2) as never);
  });

  it("opens the user's audit activity from a View Activity row action", async () => {
    vi.mocked(auditApi.searchLogs).mockResolvedValue({
      data: [
        {
          id: "a1",
          action: "CERTIFICATE_ISSUE",
          description: "Issued Blockchain Fundamentals",
          timestamp: "1767225600000",
        },
      ],
      total: 1,
    });
    renderWithProviders(<UserManagement />);

    fireEvent.click(
      await screen.findByRole("button", { name: "View activity for User 2" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Activity History — User 2",
    });
    expect(auditApi.searchLogs).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u2", take: 20 }),
    );
    expect(
      await within(dialog).findByText("Certificate issue"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Issued Blockchain Fundamentals"),
    ).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Close activity history" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows an empty state when the user has no activity", async () => {
    vi.mocked(auditApi.searchLogs).mockResolvedValue({ data: [], total: 0 });
    renderWithProviders(<UserManagement />);

    fireEvent.click(
      await screen.findByRole("button", { name: "View activity for User 1" }),
    );

    expect(await screen.findByText("No activity found.")).toBeInTheDocument();
  });

  it("surfaces a failed activity request", async () => {
    vi.mocked(auditApi.searchLogs).mockRejectedValue(new Error("Forbidden"));
    renderWithProviders(<UserManagement />);

    fireEvent.click(
      await screen.findByRole("button", { name: "View activity for User 1" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
  });
});
