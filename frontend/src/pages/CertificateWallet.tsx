import { useEffect, useMemo, useState } from "react";
import {
  Wallet,
  Download,
  Eye,
  Clock,
  QrCode,
  X,
  AlertCircle,
  Share2,
  Check,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  Certificate,
  certificateApi,
  getCertificatePdfUrl,
} from "../api";
import { UserRole, User } from "../api/types";
import { useUserCertificatesQuery } from "../api/queries";
import { useAuth } from "../context/AuthContext";


/**
 * Returns true if the logged-in user is the recipient of the given certificate.
 * Compared case-insensitively against recipientEmail; falls back to a user-id
 * match on the metadata field for legacy records that lack an email.
 */
function isCertOwner(cert: Certificate, user: User): boolean {
  if (cert.recipientEmail) {
    return cert.recipientEmail.toLowerCase() === user.email.toLowerCase();
  }
  // Fallback: some older records only carry recipientName — not reliable enough
  // to grant write actions, so treat as non-owner.
  return false;
}

/** Roles that may download any certificate regardless of ownership. */
const DOWNLOAD_ROLES: readonly UserRole[] = [UserRole.ISSUER, UserRole.ADMIN];

const CertificateWallet = () => {
  const { user } = useAuth();

  // Shared with the recipient dashboard: the certificates are fetched once and
  // both routes read the same cache entry.
  const {
    data: certificates = [],
    isPending: loading,
    isError: certificatesFailed,
  } = useUserCertificatesQuery(user?.id);

  // QR states
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({});
  const [selectedQR, setSelectedQR] = useState<string | null>(null);
  const [loadingQR, setLoadingQR] = useState<Record<string, boolean>>({});

  // Only the list request feeds the banner; the QR/PDF actions keep their own
  // message so a failed download never masquerades as a failed page load. The
  // raw transport message is not surfaced -- it is unhelpful to a user and was
  // never shown before the migration.
  const loadError = certificatesFailed
    ? "Failed to load your certificates. Please check your connection and try again."
    : null;
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? loadError;
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(9);

  // A newly signed-in user has a different wallet; never page into a stale index.
  useEffect(() => {
    setPage(1);
  }, [user?.id]);

  // QR CODE LOGIC
  const fetchQRCode = async (certificateId: string) => {
    if (qrCodes[certificateId]) return qrCodes[certificateId];

    setLoadingQR((prev) => ({ ...prev, [certificateId]: true }));

    try {
      const qrCode = await certificateApi.getQR(certificateId);
      setQrCodes((prev) => ({ ...prev, [certificateId]: qrCode }));
      return qrCode;
    } catch (error) {
      console.error("Error fetching QR code:", error);
      return null;
    } finally {
      setLoadingQR((prev) => ({ ...prev, [certificateId]: false }));
    }
  };

  const handleShowQR = async (certificateId: string) => {
    const qrCode = await fetchQRCode(certificateId);
    if (qrCode) setSelectedQR(qrCode);
  };

  // ✅ SHARE LOGIC
  const handleShare = async (cert: Certificate) => {
    const serial = cert.serialNumber || cert.id;
    const url = `${window.location.origin}/verify?serial=${encodeURIComponent(serial)}`;

    const copyToClipboard = async () => {
      await navigator.clipboard.writeText(url);
      setCopiedId(cert.id);
      setTimeout(() => setCopiedId(null), 2000);
    };

    if (navigator.share) {
      try {
        await navigator.share({
          title: cert.title,
          text: `Check out my certificate: ${cert.title} — awarded to ${cert.recipientName}`,
          url,
        });
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          await copyToClipboard();
        }
      }
    } else {
      await copyToClipboard();
    }
  };

  // ✅ PDF VIEW/DOWNLOAD LOGIC
  const handlePdfAction = async (
    cert: Certificate,
    action: "view" | "download",
  ) => {
    setActionError(null);
    setActionLoadingId(cert.id);

    try {
      let url: string | undefined | null = cert.pdfUrl;

      if (!url) {
        url = await getCertificatePdfUrl(cert.id);
      }

      // Validate URL before proceeding
      if (!url || url.trim() === "") {
        throw new Error("PDF URL not available");
      }

      // Check for placeholder/dummy URLs
      if (url.includes("/api/dummy-pdf/") || url.includes("/dummy-pdf/")) {
        throw new Error(
          "PDF not yet available - certificate is being processed",
        );
      }

      // Additional URL validation
      try {
        new URL(url); // Validate URL format
      } catch {
        throw new Error("Invalid PDF URL format");
      }

      if (action === "view") {
        // Try to open in new tab with error handling
        const newWindow = window.open(url, "_blank", "noopener,noreferrer");
        if (!newWindow) {
          // Fallback: try to download instead
          console.warn("Popup blocked, falling back to download");
          await handlePdfDownload(url, cert);
        }
      } else {
        await handlePdfDownload(url, cert);
      }
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Unknown error";

      // Provide more helpful error messages
      let userFriendlyMessage = message;
      if (message.includes("PDF not found")) {
        userFriendlyMessage =
          "Certificate PDF is not available yet. Please try again later.";
      } else if (message.includes("not yet available")) {
        userFriendlyMessage =
          "Certificate is still being processed. PDF will be available soon.";
      }

      setActionError(
        `Failed to ${action} certificate "${cert.title}". ${userFriendlyMessage}`,
      );
    } finally {
      setActionLoadingId(null);
    }
  };

  // Helper function for PDF download with retry logic
  const handlePdfDownload = async (
    url: string,
    cert: Certificate,
    retryCount = 0,
  ): Promise<void> => {
    const maxRetries = 2;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404 && retryCount < maxRetries) {
          console.warn(
            `PDF not found, retrying... (${retryCount + 1}/${maxRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second before retry
          return handlePdfDownload(url, cert, retryCount + 1);
        }
        throw new Error(`PDF unavailable (${res.status})`);
      }

      const blob = await res.blob();
      const objectUrl = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `Certificate-${cert.serialNumber || cert.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      if (retryCount >= maxRetries) {
        throw error;
      }
      throw error;
    }
  };

  const total = certificates.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const paginatedCertificates = useMemo(() => {
    const start = (page - 1) * limit;
    return certificates.slice(start, start + limit);
  }, [certificates, page, limit]);

  const getStatusBadgeClass = (status: Certificate["status"]) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
      case "revoked":
        return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
      case "expired":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
      case "frozen":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Wallet className="w-10 h-10 text-blue-600 dark:text-blue-400" />
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Certificate Wallet</h1>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3 text-red-700 dark:text-red-400">
          <AlertCircle className="w-5 h-5 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin h-12 w-12 border-b-2 border-blue-600 rounded-full mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-300">Loading certificates...</p>
        </div>
      ) : certificates.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-900 rounded-lg shadow-md dark:shadow-none dark:border dark:border-gray-800">
          <Wallet className="w-16 h-16 text-gray-400 dark:text-gray-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            No Certificates Yet
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mt-2">
            Your earned certificates will appear here
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {paginatedCertificates.map((cert) => (
              <div key={cert.id} className="bg-white dark:bg-gray-900 rounded-lg shadow-md dark:shadow-none dark:border dark:border-gray-800 p-6">
                <div className="flex justify-between mb-4">
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white">{cert.title}</h3>
                  <span
                    className={`px-2 py-1 text-sm rounded ${getStatusBadgeClass(
                      cert.status,
                    )}`}
                  >
                    {cert.status}
                  </span>
                </div>

                <div className="mb-6 space-y-2 text-gray-600 dark:text-gray-300">
                  <p>Issued to: {cert.recipientName}</p>
                  <p className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    {new Date(cert.issueDate).toLocaleDateString()}
                  </p>
                </div>

                {(() => {
                  const owner = !!user && isCertOwner(cert, user);
                  const canDownload = owner || (!!user && DOWNLOAD_ROLES.includes(user.role as UserRole));
                  const canShare = owner;
                  const readOnly = !canDownload && !canShare;

                  return (
                    <div className="space-y-3">
                      {/* Read-only actions — visible to every role */}
                      <div className="flex justify-between">
                        <button
                          onClick={() => handlePdfAction(cert, "view")}
                          disabled={actionLoadingId === cert.id}
                          className="flex items-center gap-2 text-blue-600 dark:text-blue-400 disabled:opacity-50"
                        >
                          <Eye className="w-4 h-4" />
                          View
                        </button>

                        <button
                          onClick={() => handleShowQR(cert.id)}
                          disabled={loadingQR[cert.id]}
                          className="flex items-center gap-2 text-purple-600 dark:text-purple-400 disabled:opacity-50"
                        >
                          {loadingQR[cert.id] ? (
                            <div className="animate-spin h-4 w-4 border-b-2 border-purple-600 dark:border-purple-400 rounded-full"></div>
                          ) : (
                            <QrCode className="w-4 h-4" />
                          )}
                          QR
                        </button>

                        {/* Download: recipient owner OR issuer/admin */}
                        {canDownload && (
                          <button
                            onClick={() => handlePdfAction(cert, "download")}
                            disabled={actionLoadingId === cert.id}
                            className="flex items-center gap-2 text-green-600 dark:text-green-400 disabled:opacity-50"
                          >
                            <Download className="w-4 h-4" />
                            Download
                          </button>
                        )}

                        {/* Share: recipient owner only */}
                        {canShare && (
                          <button
                            onClick={() => handleShare(cert)}
                            className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400"
                          >
                            {copiedId === cert.id ? (
                              <Check className="w-4 h-4" />
                            ) : (
                              <Share2 className="w-4 h-4" />
                            )}
                            {copiedId === cert.id ? "Copied!" : "Share"}
                          </button>
                        )}
                      </div>

                      {/* Inform non-owners (e.g. verifiers) that they have read-only access */}
                      {readOnly && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
                          View-only — download and share are available to the certificate owner.
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>

          <div className="mt-6 px-2 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-gray-200 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Showing {(page - 1) * limit + 1} to{" "}
                {Math.min(page * limit, total)} of {total} results
              </span>
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setPage(1);
                }}
                className="ml-2 px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded-md dark:bg-gray-800 dark:text-gray-200"
                aria-label="Certificates per page"
              >
                <option value={6}>6</option>
                <option value={9}>9</option>
                <option value={12}>12</option>
                <option value={24}>24</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page === 1}
                className="p-2 border border-gray-300 dark:border-gray-700 rounded-md dark:bg-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() =>
                  setPage((prev) => Math.min(totalPages, prev + 1))
                }
                disabled={page === totalPages}
                className="p-2 border border-gray-300 dark:border-gray-700 rounded-md dark:bg-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Next page"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* ✅ QR MODAL */}
      {selectedQR && (
        <div
          className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-label="Certificate QR code"
        >
          <div className="bg-white dark:bg-gray-900 p-6 rounded-lg max-w-sm w-full dark:border dark:border-gray-800">
            <div className="flex justify-between mb-4">
              <h3 className="font-semibold text-gray-900 dark:text-white">Certificate QR Code</h3>
              <button
                onClick={() => setSelectedQR(null)}
                aria-label="Close QR modal"
              >
                <X className="w-5 h-5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300" />
              </button>
            </div>

            <img
              src={selectedQR}
              alt="Certificate QR code for verification"
              role="img"
              aria-label="Certificate QR code for verification"
              className="mx-auto max-h-[300px]"
            />
            <p className="text-sm text-gray-600 dark:text-gray-300 text-center mt-4">
              Scan to verify certificate
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default CertificateWallet;
