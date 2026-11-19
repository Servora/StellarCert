import { useState } from "react";
import { ArrowRightLeft, Check, X, Inbox } from "lucide-react";
import type { CertificateTransfer } from "../api/types";
import {
  useApproveTransferMutation,
  useRejectTransferMutation,
} from "../api/queries";
import Modal from "./Modal";

interface IncomingTransfersProps {
  /** Pending transfers addressed to the current user (toEmail === user email). */
  transfers: CertificateTransfer[];
  onSuccess?: (message: string) => void;
}

type ActiveAction =
  | { kind: "approve"; transfer: CertificateTransfer }
  | { kind: "reject"; transfer: CertificateTransfer }
  | null;

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

/**
 * Recipient side of the certificate transfer flow: lists transfers waiting on
 * the current user and lets them approve (with the emailed confirmation code)
 * or reject each one.
 */
const IncomingTransfers = ({ transfers, onSuccess }: IncomingTransfersProps) => {
  const [active, setActive] = useState<ActiveAction>(null);
  const [confirmationCode, setConfirmationCode] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const approveMutation = useApproveTransferMutation();
  const rejectMutation = useRejectTransferMutation();
  const submitting = approveMutation.isPending || rejectMutation.isPending;

  if (transfers.length === 0) return null;

  const open = (kind: "approve" | "reject", transfer: CertificateTransfer) => {
    setActive({ kind, transfer } as ActiveAction);
    setConfirmationCode("");
    setRejectReason("");
    setFormError(null);
  };

  const close = () => {
    if (submitting) return;
    setActive(null);
    setFormError(null);
  };

  const trimmedCode = confirmationCode.trim();
  const codeValid = trimmedCode.length >= 6 && trimmedCode.length <= 64;

  const submit = async () => {
    if (!active) return;
    setFormError(null);
    try {
      if (active.kind === "approve") {
        if (!codeValid) {
          setFormError("Enter the confirmation code from your email.");
          return;
        }
        await approveMutation.mutateAsync({
          transferId: active.transfer.id,
          confirmationCode: trimmedCode,
        });
        onSuccess?.("Transfer approved. The certificate is now in your wallet.");
      } else {
        await rejectMutation.mutateAsync({
          transferId: active.transfer.id,
          reason: rejectReason.trim() || undefined,
        });
        onSuccess?.("Transfer rejected.");
      }
      setActive(null);
    } catch (err) {
      setFormError(
        errorMessage(
          err,
          active.kind === "approve"
            ? "Failed to approve transfer."
            : "Failed to reject transfer.",
        ),
      );
    }
  };

  const describeSender = (t: CertificateTransfer) =>
    t.fromName && t.fromEmail
      ? `${t.fromName} (${t.fromEmail})`
      : t.fromName || t.fromEmail || "Unknown sender";

  const certificateLabel = (t: CertificateTransfer) =>
    t.certificate?.title ?? `Certificate ${t.certificateId}`;

  return (
    <section
      aria-labelledby="incoming-transfers-title"
      data-testid="incoming-transfers"
      className="mb-8 bg-white dark:bg-gray-900 rounded-lg shadow-md dark:shadow-none dark:border dark:border-gray-800 p-6"
    >
      <div className="flex items-center gap-2 mb-4">
        <Inbox className="w-6 h-6 text-amber-600 dark:text-amber-400" />
        <h2
          id="incoming-transfers-title"
          className="text-xl font-semibold text-gray-900 dark:text-white"
        >
          Incoming Transfers
        </h2>
        <span className="ml-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          {transfers.length}
        </span>
      </div>

      <ul className="divide-y divide-gray-200 dark:divide-gray-800">
        {transfers.map((t) => (
          <li
            key={t.id}
            data-testid={`incoming-transfer-${t.id}`}
            className="py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
              <p className="flex items-center gap-2 font-medium text-gray-900 dark:text-white">
                <ArrowRightLeft className="w-4 h-4" />
                {certificateLabel(t)}
              </p>
              <p>From: {describeSender(t)}</p>
              {t.reason && <p>Reason: {t.reason}</p>}
              {t.expiresAt && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Expires {new Date(t.expiresAt).toLocaleString()}
                </p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => open("approve", t)}
                className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md bg-green-600 hover:bg-green-700 text-white"
              >
                <Check className="w-4 h-4" />
                Approve
              </button>
              <button
                type="button"
                onClick={() => open("reject", t)}
                className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <X className="w-4 h-4" />
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>

      <Modal
        isOpen={active !== null}
        onClose={close}
        labelledBy="incoming-transfer-action-title"
        wrapperClassName="fixed inset-0 z-50 flex items-center justify-center"
        overlayClassName="absolute inset-0 bg-black/50"
        dialogClassName="relative bg-white dark:bg-slate-900 rounded-lg p-6 max-w-md w-full mx-4"
      >
        {active && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <h3
              id="incoming-transfer-action-title"
              className="text-lg font-semibold mb-2 dark:text-white"
            >
              {active.kind === "approve" ? "Approve Transfer" : "Reject Transfer"}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              {certificateLabel(active.transfer)} from{" "}
              {describeSender(active.transfer)}
            </p>

            {active.kind === "approve" ? (
              <div className="mb-4">
                <label
                  htmlFor="transfer-confirmation-code"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Confirmation code *
                </label>
                <input
                  id="transfer-confirmation-code"
                  type="text"
                  autoComplete="one-time-code"
                  value={confirmationCode}
                  onChange={(e) => setConfirmationCode(e.target.value)}
                  maxLength={64}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md dark:bg-gray-800 dark:text-gray-100"
                  placeholder="Code from your transfer email"
                />
              </div>
            ) : (
              <div className="mb-4">
                <label
                  htmlFor="transfer-reject-reason"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Reason (optional)
                </label>
                <textarea
                  id="transfer-reject-reason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md dark:bg-gray-800 dark:text-gray-100"
                />
              </div>
            )}

            {formError && (
              <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">
                {formError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={submitting}
                className="px-4 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 dark:text-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || (active.kind === "approve" && !codeValid)}
                className={`px-4 py-2 text-sm font-medium rounded-md text-white disabled:opacity-50 ${
                  active.kind === "approve"
                    ? "bg-green-600 hover:bg-green-700"
                    : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {submitting
                  ? active.kind === "approve"
                    ? "Approving…"
                    : "Rejecting…"
                  : active.kind === "approve"
                    ? "Approve Transfer"
                    : "Reject Transfer"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
};

export default IncomingTransfers;
