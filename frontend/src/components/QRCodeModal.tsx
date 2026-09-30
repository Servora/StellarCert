import { useRef, useState, useCallback } from "react";
import { QRCodeCanvas } from "qrcode.react";
import Modal from "./Modal";

interface QRCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  certificateId: string;
  certificateName?: string;
  baseUrl?: string;
}

export default function QRCodeModal({
  isOpen,
  onClose,
  certificateId,
  certificateName = "Certificate",
  baseUrl,
}: QRCodeModalProps) {
  const qrRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const verificationUrl =
    baseUrl ||
    (typeof window !== "undefined"
      ? `${window.location.origin}/verify/${certificateId}`
      : `https://yourapp.com/verify/${certificateId}`);

  const handleDownload = useCallback(() => {
    setDownloading(true);
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) return;

    const size = 400;
    const padding = 32;
    const labelHeight = 60;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = size + padding * 2;
    exportCanvas.height = size + padding * 2 + labelHeight;

    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#0f0f13";
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    ctx.strokeStyle = "#2a2a35";
    ctx.lineWidth = 1;
    ctx.strokeRect(1, 1, exportCanvas.width - 2, exportCanvas.height - 2);

    ctx.fillStyle = "#ffffff";
    ctx.roundRect(padding - 8, padding - 8, size + 16, size + 16, 8);
    ctx.fill();
    ctx.drawImage(canvas, padding, padding, size, size);

    ctx.fillStyle = "#9898aa";
    ctx.font = "500 13px 'DM Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      "VERIFIED CERTIFICATE",
      exportCanvas.width / 2,
      size + padding * 2 + 22,
    );

    ctx.fillStyle = "#ffffff";
    ctx.font = "600 15px 'DM Mono', monospace";
    ctx.fillText(
      certificateName,
      exportCanvas.width / 2,
      size + padding * 2 + 46,
    );

    const link = document.createElement("a");
    link.download = `certificate-qr-${certificateId}.png`;
    link.href = exportCanvas.toDataURL("image/png");
    link.click();

    setTimeout(() => setDownloading(false), 800);
  }, [certificateId, certificateName]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(verificationUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      const el = document.createElement("textarea");
      el.value = verificationUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }, [verificationUrl]);

  if (!isOpen) return null;

  return (
    <>
      <style>{`
        @import url("https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap");

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        labelledBy="qr-code-modal-title"
        closeOnBackdropClick
        wrapperClassName="fixed inset-0 z-50 flex items-center justify-center p-4"
        overlayClassName="absolute inset-0 bg-black/80 backdrop-blur-sm"
        dialogClassName="relative w-full max-w-md"
        dialogStyle={{
          animation: "slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          fontFamily: "'DM Mono', 'Courier New', monospace",
        }}
      >
        <div
          className="relative overflow-hidden rounded-2xl"
          style={{
            background: "linear-gradient(145deg, #13131a 0%, #0d0d12 100%)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow:
              "0 32px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04) inset",
          }}
        >
          <div
            className="absolute top-0 left-0 right-0 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(139,92,246,0.6), rgba(59,130,246,0.6), transparent)",
            }}
          />

          <div className="flex items-center justify-between px-6 pt-6 pb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="text-xs font-medium tracking-widest uppercase"
                  style={{ color: "#7c7c9a" }}
                >
                  Certificate QR
                </span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{
                    background: "rgba(139,92,246,0.15)",
                    color: "#a78bfa",
                    border: "1px solid rgba(139,92,246,0.25)",
                  }}
                >
                  Verified
                </span>
              </div>
              <h2 id="qr-code-modal-title" className="text-white font-semibold text-lg leading-tight truncate max-w-xs">
                {certificateName}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close certificate QR code"
              className="flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200"
              style={{
                background: "rgba(255,255,255,0.05)",
                color: "#6b6b85",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                e.currentTarget.style.color = "#fff";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                e.currentTarget.style.color = "#6b6b85";
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-6 pb-4">
            <div
              className="relative flex items-center justify-center rounded-xl p-6 overflow-hidden"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {[
                "top-3 left-3 border-t border-l",
                "top-3 right-3 border-t border-r",
                "bottom-3 left-3 border-b border-l",
                "bottom-3 right-3 border-b border-r",
              ].map((cls, i) => (
                <div
                  key={i}
                  className={`absolute w-5 h-5 ${cls}`}
                  style={{ borderColor: "rgba(139,92,246,0.4)" }}
                />
              ))}

              <div ref={qrRef} className="p-3 rounded-lg" style={{ background: "#ffffff" }}>
                <QRCodeCanvas
                  value={verificationUrl}
                  size={200}
                  level="H"
                  includeMargin={false}
                  bgColor="#ffffff"
                  fgColor="#0d0d12"
                />
              </div>
            </div>

            <div
              className="mt-3 flex items-center gap-2 px-3 py-2.5 rounded-lg"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <svg
                className="flex-shrink-0"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#6b6b85"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <span className="text-xs truncate flex-1" style={{ color: "#7c7c9a", letterSpacing: "0.01em" }}>
                {verificationUrl}
              </span>
            </div>
          </div>

          <div className="px-6 pb-6 flex gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all duration-200"
              style={{
                background: copied ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${copied ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.08)"}`,
                color: copied ? "#4ade80" : "#c4c4d4",
              }}
            >
              {copied ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copy Link
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownload}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all duration-200"
              style={{
                background: downloading
                  ? "rgba(139,92,246,0.3)"
                  : "linear-gradient(135deg, rgba(139,92,246,0.9), rgba(79,70,229,0.9))",
                border: "1px solid rgba(139,92,246,0.4)",
                color: "#ffffff",
                boxShadow: "0 4px 16px rgba(139,92,246,0.25)",
              }}
            >
              {downloading ? (
                <>
                  <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Saving...
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download PNG
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
