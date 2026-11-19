import { useState, useEffect } from "react";
import type { JSX } from "react";
import { useParams } from "react-router-dom";
import { Copy, ExternalLink } from "lucide-react";
import { usePublicCertificateQuery } from "../api/queries";
import { publicCertificateApi } from "../api/endpoints";

const STATUS_STYLES: Record<string, string> = {
  valid: "bg-emerald-500/20 text-emerald-300",
  revoked: "bg-red-500/20 text-red-300",
  expired: "bg-yellow-500/20 text-yellow-300",
  frozen: "bg-sky-500/20 text-sky-300",
};

const formatDate = (value: string | undefined): string => {
  if (!value) return "N/A";
  try {
    return new Date(value).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return value;
  }
};

/**
 * Public certificate share page (#1178): `/c/:publicId`.
 *
 * Renders the privacy-preserving projection of a certificate — no email, no
 * verification code — together with the chain-proof panel linking the
 * anchoring transaction to Stellar Expert, and copy-ready embed snippets
 * (iframe, image, markdown) so a holder can drop the badge onto LinkedIn or
 * their own site.
 */
export default function CertificatePublic(): JSX.Element {
  const { publicId = "" } = useParams<{ publicId: string }>();
  const { data, isPending, isError } = usePublicCertificateQuery(publicId);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timeoutId = window.setTimeout(() => setCopied(null), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [copied]);

  const copy = (label: string, text: string) => {
    const fallback = () => {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "absolute";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
        setCopied(label);
      } catch {
        setCopied(null);
      }
      document.body.removeChild(el);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => setCopied(label),
        fallback,
      );
    } else {
      fallback();
    }
  };

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-24" role="status">
        <div
          className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary"
          aria-hidden="true"
        />
        <span className="sr-only">Loading certificate…</span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="py-24 text-center">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          Certificate not found
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
          No certificate with serial “{publicId}” exists. Double-check the
          serial with the person who issued it.
        </p>
      </div>
    );
  }

  const origin = window.location.origin;
  const pageUrl = `${origin}/c/${encodeURIComponent(data.publicId)}`;
  const badgeUrl = publicCertificateApi.badgeUrl(data.publicId);
  const embedUrl = publicCertificateApi.embedUrl(data.publicId);

  const snippets = [
    {
      key: "iframe",
      label: "Embed (iframe)",
      code: `<iframe src="${embedUrl}" width="320" height="80" style="border:0" title="Verified certificate"></iframe>`,
    },
    {
      key: "image",
      label: "Image badge",
      code: `<img src="${badgeUrl}" alt="Verified certificate" width="320" height="80">`,
    },
    {
      key: "markdown",
      label: "Markdown (LinkedIn, GitHub)",
      code: `[![Verified certificate](${badgeUrl})](${pageUrl})`,
    },
  ];

  return (
    <section className="mx-auto max-w-3xl space-y-8 py-8">
      {/* Certificate card */}
      <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Verified Certificate
            </p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
              {data.title}
            </h1>
            {data.courseName && (
              <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">
                {data.courseName}
              </p>
            )}
          </div>
          <span
            className={`inline-block shrink-0 rounded-full px-3 py-1 text-xs font-semibold capitalize ${
              STATUS_STYLES[data.status] ?? "bg-slate-500/20 text-gray-600"
            }`}
          >
            {data.status}
          </span>
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Awarded To
            </dt>
            <dd className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
              {data.recipientName}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Issuer
            </dt>
            <dd className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
              {data.issuerName || "Unknown"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Issue Date
            </dt>
            <dd className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
              {formatDate(data.issuedAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Serial
            </dt>
            <dd className="mt-1 break-all text-sm font-medium text-gray-900 dark:text-white">
              {data.publicId}
            </dd>
          </div>
        </dl>

        {data.description && (
          <p className="mt-6 text-sm text-gray-600 dark:text-slate-300">
            {data.description}
          </p>
        )}
      </div>

      {/* Chain proof panel */}
      <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 p-6">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          Chain Proof
        </h2>
        {data.chainProof.anchored && data.chainProof.transactionHash ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-gray-600 dark:text-slate-300">
              This certificate is anchored on the Stellar network. Anyone can
              independently confirm the issuance transaction below.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <code className="break-all rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs text-gray-900 dark:text-slate-200">
                {data.chainProof.transactionHash}
              </code>
              {data.chainProof.explorerUrl && (
                <a
                  href={data.chainProof.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-slate-950 transition hover:brightness-110"
                >
                  View on Stellar Expert
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-gray-500 dark:text-slate-400">
            This certificate is recorded off-chain only; there is no Stellar
            transaction to inspect.
          </p>
        )}
      </div>

      {/* Embed snippets */}
      <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 p-6">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          Share &amp; Embed
        </h2>
        <div className="mt-4 space-y-4">
          <img
            src={badgeUrl}
            alt={`Verification badge for ${data.title}`}
            width={320}
            height={80}
            className="rounded-lg"
          />
          {snippets.map((snippet) => (
            <div key={snippet.key}>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                {snippet.label}
              </p>
              <div className="mt-1 flex items-start gap-2">
                <code className="flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs text-gray-900 dark:text-slate-200">
                  {snippet.code}
                </code>
                <button
                  type="button"
                  onClick={() => copy(snippet.key, snippet.code)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-slate-900/60 px-3 py-2 text-xs font-medium text-gray-900 dark:text-white transition hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label={`Copy ${snippet.label} snippet`}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  {copied === snippet.key ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
