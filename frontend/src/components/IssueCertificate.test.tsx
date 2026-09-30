import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import IssueCertificate from "./IssueCertificate";

describe("IssueCertificate", () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the success confirmation after a valid submission", async () => {
    render(<IssueCertificate />);

    fireEvent.change(screen.getByLabelText(/Full Name/i), {
      target: { value: "Jane Doe" },
    });
    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: "jane@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Stellar Wallet Address/i), {
      target: { value: "G" + "A".repeat(55) },
    });
    fireEvent.change(screen.getByLabelText(/Certificate Title/i), {
      target: { value: "Certified Blockchain Developer" },
    });
    fireEvent.change(screen.getByLabelText(/Issuer \/ Organization/i), {
      target: { value: "Acme Academy" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Issue Certificate/i }));

    // The component simulates the network round-trip (~1.5s) before confirming
    await waitFor(
      () => {
        expect(alertSpy).toHaveBeenCalledWith(
          "Certificate issued successfully on the Stellar network!",
        );
      },
      { timeout: 4000 },
    );
  });

  it("shows validation errors instead of submitting when required fields are empty", async () => {
    render(<IssueCertificate />);

    fireEvent.click(screen.getByRole("button", { name: /Issue Certificate/i }));

    expect(
      await screen.findByText("Recipient name is required"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Stellar wallet address is required"),
    ).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
