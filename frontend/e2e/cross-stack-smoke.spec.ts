import { test, expect } from "@playwright/test";
import pg from "pg";
import { E2E_USERS } from "./seed.mjs";

const DB_CONFIG = {
  host: process.env.E2E_DB_HOST ?? "localhost",
  port: Number(process.env.E2E_DB_PORT ?? "5433"),
  user: process.env.E2E_DB_USER ?? "stellarwave_user",
  password: process.env.E2E_DB_PASSWORD ?? "stellarwave_password",
  database: process.env.E2E_DB_NAME ?? "stellarwave",
};

async function queryDb<T = unknown>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client(DB_CONFIG);
  await client.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    await client.end();
  }
}

async function login(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
) {
  await page.goto("/login");
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  // Wait for a concrete authenticated-only signal rather than just the URL:
  // AuthContext hydrates asynchronously, so navigating immediately after a
  // URL match can still race the app treating the session as logged in.
  await expect(page.getByText("Sign out").first()).toBeVisible({
    timeout: 15_000,
  });
}

// Each run uses a unique course name so the suite is safe to re-run against a
// database that already has certificates from a previous run.
const runId = Date.now();
const COURSE_NAME = `E2E Smoke Course ${runId}`;

test.describe("cross-stack smoke: issue -> verify -> transfer", () => {
  test("a certificate issued by the issuer can be publicly verified and a transfer can be initiated", async ({
    page,
  }) => {
    // --- Issue ---------------------------------------------------------
    await login(page, E2E_USERS.issuer.email, E2E_USERS.issuer.password);

    await page.goto("/issue");
    await expect(page.locator("#template")).not.toHaveValue("", {
      timeout: 15_000,
    });

    await page.locator("#recipientName").fill("E2E Recipient");
    await page.locator("#recipientEmail").fill(E2E_USERS.recipient.email);
    await page.locator("#courseName").fill(COURSE_NAME);
    await page.locator("#grade").selectOption({ label: "A" });
    await page
      .locator("#issueDate")
      .fill(new Date().toISOString().slice(0, 10));

    await page.getByRole("button", { name: /preview certificate/i }).click();

    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "POST" &&
          res.url().endsWith("/certificates"),
      ),
      page.getByRole("button", { name: /confirm and issue/i }).click(),
    ]);
    const createBody = await createResponse.text();
    expect(
      createResponse.ok(),
      `POST /certificates failed (${createResponse.status()}): ${createBody}`,
    ).toBe(true);
    // Every API response is wrapped in a {statusCode, message, data, ...}
    // envelope by a global interceptor.
    const created = (
      JSON.parse(createBody) as {
        data: { id: string; serialNumber: string; verificationCode: string };
      }
    ).data;
    expect(created.verificationCode).toBeTruthy();

    await expect(
      page.getByText("Certificate issued successfully!"),
    ).toBeVisible();

    // --- Verify (public page, no auth) ----------------------------------
    // Verification is keyed by the certificate's verificationCode, a
    // separate value from its serialNumber/certificateId.
    await page.goto(`/verify/${encodeURIComponent(created.verificationCode)}`);
    await expect(page.getByText("Certificate Verified")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(COURSE_NAME)).toBeVisible();

    // --- Transfer (initiate) --------------------------------------------
    // Still the same issuer session from the top of the test - /verify is a
    // public page and doesn't touch it.
    await page.goto("/certificates");

    const row = page.getByRole("row", { name: new RegExp(COURSE_NAME) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByTitle("Transfer Certificate").click();

    await page.locator("#transfer-owner-name").fill("New Owner");
    await page.locator("#transfer-owner-email").fill(E2E_USERS.recipient.email);

    const [transferResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "POST" &&
          res.url().endsWith("/certificates/transfers/initiate"),
      ),
      page.getByRole("button", { name: /^initiate transfer$/i }).click(),
    ]);
    expect(
      transferResponse.ok(),
      `POST /certificates/transfers/initiate failed (${transferResponse.status()}): ${await transferResponse.text()}`,
    ).toBe(true);

    // The write actually landed: a pending transfer row now exists for this
    // certificate, queued for the new owner to approve (confirms the full
    // frontend -> API -> database -> email-queue path, not just a 2xx).
    const transferRows = await queryDb<{
      status: string;
      toEmail: string;
    }>(
      `SELECT status, "toEmail"
       FROM certificate_transfers
       WHERE "certificateId" = $1
       ORDER BY "initiatedAt" DESC
       LIMIT 1`,
      [created.id],
    );
    expect(transferRows).toHaveLength(1);
    expect(transferRows[0].status).toBe("pending");
    expect(transferRows[0].toEmail).toBe(E2E_USERS.recipient.email);
  });
});
