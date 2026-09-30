import { useEffect, useRef, useState, useCallback } from "react";
import Modal from "./Modal";

interface ScanResult {
  url: string;
  certificateId: string | null;
  raw: string;
}

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess?: (result: ScanResult) => void;
  verifyPathPrefix?: string;
}

type ScannerStatus = "initializing" | "scanning" | "error" | "success";

export default function QRScannerModal({
  isOpen,
  onClose,
  onScanSuccess,
  verifyPathPrefix = "/verify/",
}: QRScannerModalProps) {
  const scannerRef = useRef<unknown>(null);
  const containerId = "qr-scanner-container";

  const [status, setStatus] = useState<ScannerStatus>("initializing");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [resultCopied, setResultCopied] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      const scanner = scannerRef.current as {
        getState?: () => number;
        stop: () => Promise<void>;
        clear?: () => void;
      };
      try {
        const state = scanner.getState?.();
        if (state === 2) {
          await scanner.stop();
        }
        scanner.clear?.();
      } catch {
        // ignore
      }
      scannerRef.current = null;
    }
  }, []);

  const extractCertificateId = useCallback((raw: string): string | null => {
    try {
      const url = new URL(raw);
      const parts = url.pathname.split(verifyPathPrefix);
      if (parts.length > 1 && parts[1]) return parts[1];
    } catch {
      // not a URL
    }
    return null;
  }, [verifyPathPrefix]);

  const startScanner = useCallback(async () => {
    if (!isOpen) return;
    setStatus("initializing");
    setErrorMsg("");
    setScanResult(null);

    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const devices = await Html5Qrcode.getCameras();
      setHasMultipleCameras(devices.length > 1);

      const scanner = new Html5Qrcode(containerId, { verbose: false });
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode },
        {
          fps: 10,
          qrbox: { width: 220, height: 220 },
          aspectRatio: 1,
        },
        (decodedText) => {
          const result: ScanResult = {
            url: decodedText,
            certificateId: extractCertificateId(decodedText),
            raw: decodedText,
          };
          setScanResult(result);
          setStatus("success");
          stopScanner();
          onScanSuccess?.(result);
        },
        () => {
          // scan frame error, ignore
        }
      );

      setStatus("scanning");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      let friendly = "Camera access failed.";
      if (msg.includes("Permission") || msg.includes("permission") || msg.includes("NotAllowed")) {
        friendly = "Camera permission denied. Please allow camera access in your browser settings and try again.";
      } else if (msg.includes("NotFound") || msg.includes("not found")) {
        friendly = "No camera detected on this device.";
      } else if (msg.includes("NotReadable") || msg.includes("in use")) {
        friendly = "Camera is in use by another application. Please close it and try again.";
      } else if (msg.includes("OverconstrainedError")) {
        friendly = "Rear camera unavailable. Try switching to the front camera.";
      }
      setErrorMsg(friendly);
      setStatus("error");
    }
  }, [isOpen, facingMode, onScanSuccess, stopScanner, extractCertificateId]);

  useEffect(() => {
    if (isOpen) {
      startScanner();
    } else {
      stopScanner();
      setScanResult(null);
      setStatus("initializing");
      setTorchOn(false);
    }
    return () => {
      stopScanner();
    };
  }, [isOpen, facingMode, startScanner, stopScanner]);

  const handleToggleTorch = async () => {
    if (!scannerRef.current) return;
    try {
      const scanner = scannerRef.current as {
        _localMediaStream?: {
          getVideoTracks: () => MediaStreamTrack[];
        };
      };
      const track = scanner._localMediaStream?.getVideoTracks()[0];
      if (!track) return;

      const capabilities = track.getCapabilities() as { torch?: boolean };
      if (!capabilities.torch) return;

      const newVal = !torchOn;
      await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({ advanced: [{ torch: newVal }] });
      setTorchOn(newVal);
    } catch {
      // torch not supported
    }
  };

  const handleFlipCamera = async () => {
    await stopScanner();
    setFacingMode((f) => (f === "environment" ? "user" : "environment"));
  };

  const handleCopyResult = async () => {
    if (!scanResult) return;
    await navigator.clipboard.writeText(scanResult.url);
    setResultCopied(true);
    setTimeout(() => setResultCopied(false), 2500);
  };

  const handleOpenLink = () => {
    if (!scanResult) return;
    window.open(scanResult.url, "_blank", "noopener,noreferrer");
  };

  const handleRescan = async () => {
    setScanResult(null);
    setStatus("initializing");
    await startScanner();
  };

  if (!isOpen) return null;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        labelledBy="qr-scanner-modal-title"
        closeOnBackdropClick
        wrapperClassName="fixed inset-0 z-50 flex items-center justify-center p-4"
        overlayClassName="absolute inset-0 bg-black/85 backdrop-blur-sm"
        dialogClassName="relative w-full max-w-sm"
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
            boxShadow: "0 32px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04) inset",
          }}
        >
          <div
            className="absolute top-0 left-0 right-0 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(59,130,246,0.6), rgba(139,92,246,0.6), transparent)",
            }}
          />

          <div className="flex items-center justify-between px-5 pt-5 pb-4">
            <div>
              <span className="text-xs font-medium tracking-widest uppercase" style={{ color: "#7c7c9a" }}>
                QR Scanner
              </span>
              <h2 id="qr-scanner-modal-title" className="text-white font-semibold text-base leading-tight mt-0.5">
                {status === "success" ? "Scan Complete" : "Scan Certificate"}
              </h2>
            </div>

            <div className="flex items-center gap-1.5">
              {status === "scanning" && (
                <button
                  type="button"
                  onClick={handleToggleTorch}
                  title="Toggle flashlight"
                  aria-label="Toggle flashlight"
                  aria-pressed={torchOn}
                  className="flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200"
                  style={{
                    background: torchOn ? "rgba(251,191,36,0.2)" : "rgba(255,255,255,0.05)",
                    border: `1px solid ${torchOn ? "rgba(251,191,36,0.4)" : "rgba(255,255,255,0.07)"}`,
                    color: torchOn ? "#fbbf24" : "#6b6b85",
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </button>
              )}
              {status === "scanning" && hasMultipleCameras && (
                <button
                  type="button"
                  onClick={handleFlipCamera}
                  title="Flip camera"
                  aria-label="Flip camera"
                  className="flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.07)",
                    color: "#6b6b85",
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close QR scanner"
                className="flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  color: "#6b6b85",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#fff";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "#6b6b85";
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="px-5 pb-5">
            {status !== "success" && (
              <div
                className="relative overflow-hidden rounded-xl"
                style={{
                  background: "#000",
                  border: "1px solid rgba(255,255,255,0.07)",
                  aspectRatio: "1",
                }}
              >
                <div id={containerId} className="w-full h-full" style={{ minHeight: "280px" }} />

                {status === "scanning" && (
                  <>
                    {[
                      "top-8 left-8 border-t-2 border-l-2",
                      "top-8 right-8 border-t-2 border-r-2",
                      "bottom-8 left-8 border-b-2 border-l-2",
                      "bottom-8 right-8 border-b-2 border-r-2",
                    ].map((cls, i) => (
                      <div
                        key={i}
                        className={`absolute w-7 h-7 ${cls} pointer-events-none`}
                        style={{ borderColor: "rgba(139,92,246,0.8)" }}
                      />
                    ))}
                    <div
                      className="absolute left-8 right-8 h-px pointer-events-none"
                      style={{
                        background: "linear-gradient(90deg, transparent, rgba(139,92,246,0.9), transparent)",
                        animation: "scanLine 2s ease-in-out infinite",
                        boxShadow: "0 0 8px rgba(139,92,246,0.6)",
                        top: "50%",
                      }}
                    />
                  </>
                )}

                {status === "initializing" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
                      style={{ borderColor: "rgba(139,92,246,0.6)", borderTopColor: "transparent" }}
                    />
                    <span className="text-xs" style={{ color: "#6b6b85" }}>
                      Starting camera…
                    </span>
                  </div>
                )}

                {status === "error" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6">
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center"
                      style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.25)" }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="15" y1="9" x2="9" y2="15" />
                        <line x1="9" y1="9" x2="15" y2="15" />
                      </svg>
                    </div>
                    <p className="text-center text-sm leading-relaxed" style={{ color: "#9898aa" }}>
                      {errorMsg}
                    </p>
                    <button
                      type="button"
                      onClick={startScanner}
                      className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                      style={{
                        background: "rgba(139,92,246,0.2)",
                        border: "1px solid rgba(139,92,246,0.35)",
                        color: "#a78bfa",
                      }}
                    >
                      Try Again
                    </button>
                  </div>
                )}
              </div>
            )}

            {status === "success" && scanResult && (
              <div style={{ animation: "slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)" }}>
                <div className="flex flex-col items-center mb-4">
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center mb-3"
                    style={{
                      background: "rgba(34,197,94,0.15)",
                      border: "1px solid rgba(34,197,94,0.3)",
                    }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <p className="text-sm" style={{ color: "#7c7c9a" }}>QR code scanned successfully</p>
                </div>

                {scanResult.certificateId && (
                  <div
                    className="mb-3 px-3 py-2 rounded-lg flex items-center gap-2"
                    style={{
                      background: "rgba(139,92,246,0.1)",
                      border: "1px solid rgba(139,92,246,0.2)",
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" aria-hidden="true">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    <span className="text-xs" style={{ color: "#7c7c9a" }}>Certificate ID:</span>
                    <span className="text-xs font-medium truncate" style={{ color: "#c4b5fd" }}>
                      {scanResult.certificateId}
                    </span>
                  </div>
                )}

                <div
                  className="mb-4 px-3 py-2.5 rounded-lg"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <p className="text-xs mb-1" style={{ color: "#6b6b85" }}>Verification URL</p>
                  <p className="text-xs break-all" style={{ color: "#9898aa" }}>{scanResult.url}</p>
                </div>

                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={handleCopyResult}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium transition-all"
                    style={{
                      background: resultCopied ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.05)",
                      border: `1px solid ${resultCopied ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.08)"}`,
                      color: resultCopied ? "#4ade80" : "#c4c4d4",
                    }}
                  >
                    {resultCopied ? (
                      <>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Copied!
                      </>
                    ) : (
                      <>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        Copy Link
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleOpenLink}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium transition-all"
                    style={{
                      background: "linear-gradient(135deg, rgba(139,92,246,0.9), rgba(79,70,229,0.9))",
                      border: "1px solid rgba(139,92,246,0.4)",
                      color: "#ffffff",
                      boxShadow: "0 4px 16px rgba(139,92,246,0.25)",
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    Verify Now
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleRescan}
                  className="w-full py-2.5 rounded-xl text-sm transition-all"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    color: "#6b6b85",
                  }}
                >
                  Scan another
                </button>
              </div>
            )}

            {status === "scanning" && (
              <p className="text-center text-xs mt-3" style={{ color: "#4a4a5e" }}>
                Point camera at a certificate QR code
              </p>
            )}
          </div>
        </div>
      </Modal>

      <style dangerouslySetInnerHTML={{
        __html: `
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes scanLine {
          0%, 100% { transform: translateY(-80px); opacity: 0.4; }
          50% { transform: translateY(80px); opacity: 1; }
        }

        #${containerId} video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
          border-radius: 0 !important;
        }
        #${containerId} img {
          display: none !important;
        }
        #${containerId} > div:last-child {
          display: none !important;
        }
      `}} />
    </>
  );
}
