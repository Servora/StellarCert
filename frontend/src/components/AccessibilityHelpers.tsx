// Skip link, main landmark and copy-to-clipboard button. Closes #1340, #1341.
import React, { useState } from 'react';

export const MAIN_CONTENT_ID = 'main-content';

// Render first inside the layout, before <Navbar />.
export const SkipToContent: React.FC = () => (
  <a
    href={`#${MAIN_CONTENT_ID}`}
    className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
  >
    Skip to main content
  </a>
);

// Wrap the page content (replaces the plain container div).
export const MainLandmark: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => (
  <main id={MAIN_CONTENT_ID} tabIndex={-1} className={className}>
    {children}
  </main>
);

// Shows long identifiers (serial number, tx hash, CID) with a one-click copy button.
export const CopyableValue: React.FC<{ value: string; label: string }> = ({ value, label }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <code className="break-all font-mono text-xs">{value}</code>
      <button type="button" onClick={copy} aria-label={`Copy ${label}`} className="rounded border px-2 py-0.5 text-xs">
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
};
