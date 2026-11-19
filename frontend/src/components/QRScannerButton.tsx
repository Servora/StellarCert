import { useState, lazy, Suspense } from "react";

const QRScannerModal = lazy(() => import("./QRScannerModal"));

interface QRScannerButtonProps {
  onScan?: (certificateId: string) => void;
  verifyPathPrefix?: string;
}

/**
 * A button that opens the lazy-loaded QRScannerModal.
 * Replaces the inline Html5QrcodeScanner usage in VerifyCertificate.
 */
export default function QRScannerButton({
  onScan,
  verifyPathPrefix = "/verify/",
}: QRScannerButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        aria-label="Scan QR code"
      >
        Scan QR
      </button>
      <Suspense fallback={null}>
        {isOpen && (
          <QRScannerModal
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            verifyPathPrefix={verifyPathPrefix}
            onScanSuccess={(result) => {
              setIsOpen(false);
              if (result.certificateId && onScan) {
                onScan(result.certificateId);
              }
            }}
          />
        )}
      </Suspense>
    </>
  );
}