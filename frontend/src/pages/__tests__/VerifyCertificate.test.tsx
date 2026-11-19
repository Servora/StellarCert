import React from "react";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createTestQueryClient,
  renderWithProviders,
} from "../../test/renderWithProviders";

// ── API mock ───────────────────────────────────────────────────────────────
// Mocked at the endpoints module: verification now runs through the query layer,
// which imports its fetcher from there.
const { verifyMock } = vi.hoisted(() => ({ verifyMock: vi.fn() }));

vi.mock("../../api/endpoints", () => ({
  certificateApi: {
    verify: verifyMock,
  },
}));

// ── QRScannerModal mock (camera scanner is irrelevant to these tests) ─────
vi.mock("../../components/QRScannerModal", () => ({
  default: vi.fn(
    ({
      isOpen,
      onClose,
      onScanSuccess,
    }: {
      isOpen: boolean;
      onClose: () => void;
      onScanSuccess?: (result: {
        url: string;
        certificateId: string | null;
        raw: string;
      }) => void;
    }) =>
      isOpen ? (
        <div data-testid="qr-scanner-modal">
          <button onClick={onClose}>Close Scanner</button>
          <button
            onClick={() =>
              onScanSuccess?.({
                url: "https://stellarcert.org/verify/MOCK-SCANNED-ID",
                certificateId: "MOCK-SCANNED-ID",
                raw: "MOCK-SCANNED-ID",
              })
            }
          >
            Simulate Scan
          </button>
        </div>
      ) : null,
  ),
}));

import VerifyCertificate from "../VerifyCertificate";

const VALID_RESULT = {
  isValid: true,
  status: "valid",
  message: "Certificate is valid",
  certificate: {
    id: "cert-1",
    recipientName: "Jordan Lewis",
    courseName: "Blockchain Fundamentals",
    issuerName: "Stellar Academy",
    issueDate: "2026-01-15",
    status: "active",
  },
};

/** jsdom ships without the async Clipboard API — install a per-test stand-in. */
function mockClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

/** jsdom does not implement the legacy document.execCommand — stub it per test. */
function mockExecCommand(result: boolean) {
  const fn = vi.fn().mockReturnValue(result);
  Object.defineProperty(document, "execCommand", {
    value: fn,
    configurable: true,
  });
  return fn;
}

describe("VerifyCertificate share actions (toast, not alert)", () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;
  let execCommandMock: ReturnType<typeof mockExecCommand>;

  beforeEach(() => {
    verifyMock.mockResolvedValue(VALID_RESULT);
    alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    // Legacy fallback fails by default; individual tests override it
    execCommandMock = mockExecCommand(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderPage() {
    return renderWithProviders(<VerifyCertificate />, {
      queryClient: createTestQueryClient(),
      routerEntries: ["/verify?serial=CERT-123"],
    });
  }

  async function openSharePanel() {
    renderPage();
    return screen.findByRole("button", { name: /Copy Link/i });
  }

  it("shows the success toast (no alert) when Copy Link succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);

    const copyButton = await openSharePanel();
    fireEvent.click(copyButton);

    // The existing toast — previously unreachable dead code — is now shown
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Link copied to clipboard!",
      ),
    );

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain("/verify?serial=CERT-123");
    // The blocking window.alert fallback must be gone
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("shows an error toast when the clipboard API fails and the legacy fallback fails too", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("Clipboard denied")));

    const copyButton = await openSharePanel();
    fireEvent.click(copyButton);

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Copy failed. Please copy the link manually.",
      ),
    );

    expect(alertSpy).not.toHaveBeenCalled();
    expect(execCommandMock).toHaveBeenCalledWith("copy");
  });

  it("shows the success toast when the legacy copy fallback succeeds", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("HTTP context")));
    execCommandMock = mockExecCommand(true);

    const copyButton = await openSharePanel();
    fireEvent.click(copyButton);

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Link copied to clipboard!",
      ),
    );

    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("copies via the clipboard (toast) when Share is used without Web Share support", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    // jsdom has no navigator.share — the else branch must be exercised
    expect(navigator.share).toBeUndefined();

    renderPage();
    const shareButton = await screen.findByRole("button", { name: /Share/i });
    fireEvent.click(shareButton);

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Link copied to clipboard!",
      ),
    );

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("Certificate Verified: Jordan Lewis");
    expect(copied).toContain("/verify?serial=CERT-123");
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe("VerifyCertificate QR scanner integration", () => {
  it("opens QRScannerModal when Scan QR is clicked and updates serial on scan", async () => {
    renderWithProviders(<VerifyCertificate />, {
      queryClient: createTestQueryClient(),
      routerEntries: ["/verify"],
    });

    const scanQrButton = screen.getByRole("button", { name: /Scan QR/i });
    fireEvent.click(scanQrButton);

    expect(screen.getByTestId("qr-scanner-modal")).toBeInTheDocument();

    const simulateScanButton = screen.getByText("Simulate Scan");
    fireEvent.click(simulateScanButton);

    expect(screen.queryByTestId("qr-scanner-modal")).not.toBeInTheDocument();
    const serialInput = screen.getByLabelText(
      /Certificate Serial Number/i,
    ) as HTMLInputElement;
    expect(serialInput.value).toBe("MOCK-SCANNED-ID");
  });
});

describe("VerifyCertificate committed-serial verification", () => {
  beforeEach(() => {
    verifyMock.mockReset();
    verifyMock.mockResolvedValue(VALID_RESULT);
  });

  it("does not call the API while typing, only on submit", async () => {
    renderWithProviders(<VerifyCertificate />, {
      queryClient: createTestQueryClient(),
      routerEntries: ["/verify"],
    });

    const input = screen.getByLabelText(/Certificate Serial Number/i);
    for (const partial of ["CE", "CERT", "CERT-12", "CERT-123"]) {
      fireEvent.change(input, { target: { value: partial } });
    }
    // Longer than the old 300 ms debounce, which used to fire a lookup here.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(verifyMock).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: /Verify Certificate/i }),
    );
    await waitFor(() => expect(verifyMock).toHaveBeenCalledTimes(1));
    expect(verifyMock).toHaveBeenCalledWith("CERT-123");
  });

  it("verifies a serial passed in the URL without a submit", async () => {
    renderWithProviders(<VerifyCertificate />, {
      queryClient: createTestQueryClient(),
      routerEntries: ["/verify?serial=CERT-456"],
    });

    await waitFor(() => expect(verifyMock).toHaveBeenCalledWith("CERT-456"));
  });

  it("verifies a serial supplied as a legacy path segment", async () => {
    // QR codes and PDFs printed before #1242 used `/verify/<code>`.
    renderWithProviders(
      <Routes>
        <Route path="/verify/:code" element={<VerifyCertificate />} />
      </Routes>,
      {
        queryClient: createTestQueryClient(),
        routerEntries: ["/verify/CERT-789"],
      },
    );

    await waitFor(() => expect(verifyMock).toHaveBeenCalledWith("CERT-789"));
    const serialInput = screen.getByLabelText(
      /Certificate Serial Number/i,
    ) as HTMLInputElement;
    expect(serialInput.value).toBe("CERT-789");
  });
});
