import { Link } from "react-router-dom";
import {
  Award,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  Download,
  FileText,
  Search,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import { UserRole } from "../api";
import {
  useDashboardSummaryQuery,
  useUserCertificatesQuery,
  useVerifyCertificateMutation,
} from "../api/queries";
import { useAuth } from "../context/AuthContext";
import type {
  Certificate,
  ActivityItem,
  IssuanceTrendPoint,
  StatusDistribution,
} from "../api";
import AdminAnalyticsDashboard from "./AdminAnalyticsDashboard";

type DateRange = {
  startDate: string;
  endDate: string;
};

type MetricCardProps = {
  label: string;
  value: number;
  accentClassName: string;
};

const MetricCard = ({ label, value, accentClassName }: MetricCardProps) => (
  <div className="bg-white dark:bg-slate-900 p-6 rounded-lg shadow-md dark:shadow-lg dark:border dark:border-slate-700 transition-colors duration-250">
    <p className="text-sm font-medium text-gray-500 dark:text-slate-400 transition-colors duration-250">
      {label}
    </p>
    <p
      className={`mt-2 text-3xl font-bold ${accentClassName} dark:text-blue-400 transition-colors duration-250`}
    >
      {value}
    </p>
  </div>
);

type IssuanceChartProps = {
  data: IssuanceTrendPoint[];
};

// Approximate width of a rendered tick label at the chart's font size, used to
// decide how many labels fit before they start colliding.
const TICK_LABEL_WIDTH = 40;
const MIN_BAR_WIDTH = 2;

/**
 * The API sends YYYY-MM-DD, but IssuanceTrendPoint only promises a string, and
 * a YYYY-MM period would slice(5) down to an empty label.
 */
const formatPeriodLabel = (date: string): string =>
  date.length >= 10 ? date.slice(5) : date;

const IssuanceChart = ({ data }: IssuanceChartProps) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const titleId = useId();
  const descId = useId();

  if (!data.length) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-gray-500">
        No issuance data available for the selected period.
      </div>
    );
  }

  const maxCount = Math.max(...data.map((d) => d.count));
  if (maxCount === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-gray-500">
        No certificates were issued in this period.
      </div>
    );
  }

  const chartHeight = 200;
  const minChartWidth = 400;
  const padding = { top: 16, right: 12, bottom: 32, left: 40 };
  const innerHeight = chartHeight - padding.top - padding.bottom;
  const innerWidth = minChartWidth - padding.left - padding.right;

  // Dense series get tighter gaps, and if the bars would still be squeezed to
  // slivers the chart grows and scrolls horizontally rather than becoming an
  // unreadable comb.
  const gap = data.length > 24 ? 2 : 8;
  const idealBarWidth =
    (innerWidth - gap * (data.length - 1)) / data.length;
  const barWidth = Math.max(MIN_BAR_WIDTH, idealBarWidth);
  const svgWidth = Math.max(
    minChartWidth,
    padding.left + padding.right + data.length * (barWidth + gap) - gap,
  );

  const centerX = (index: number) =>
    padding.left + index * (barWidth + gap) + barWidth / 2;
  const barTop = (count: number) =>
    padding.top + innerHeight - (count / maxCount) * innerHeight;

  // Thin the x-axis labels so they never overlap, but always keep the final
  // period: it is the one a reader most often wants to compare against.
  const ticks: Array<{ x: number; label: string }> = [];
  let lastTickX = -Infinity;
  data.forEach((point, index) => {
    const x = centerX(index);
    if (x - lastTickX >= TICK_LABEL_WIDTH) {
      ticks.push({ x, label: formatPeriodLabel(point.date) });
      lastTickX = x;
    }
  });
  const lastIndex = data.length - 1;
  const finalTick = { x: centerX(lastIndex), label: formatPeriodLabel(data[lastIndex].date) };
  if (ticks.length === 0) {
    ticks.push(finalTick);
  } else if (ticks[ticks.length - 1].x !== finalTick.x) {
    // Too close to the previous tick to sit beside it, so it takes its place.
    if (finalTick.x - ticks[ticks.length - 1].x < TICK_LABEL_WIDTH) {
      ticks[ticks.length - 1] = finalTick;
    } else {
      ticks.push(finalTick);
    }
  }

  // Deduplicated because maxCount of 1 would otherwise round the midpoint to 1
  // as well and render two gridlines on top of each other.
  const gridValues = Array.from(
    new Set([maxCount, Math.round(maxCount / 2), 0]),
  );
  const peak = data.reduce((best, point) =>
    point.count > best.count ? point : best,
  );
  const activePoint = activeIndex === null ? null : data[activeIndex];

  // Laid out in SVG user units rather than as an absolutely positioned div, so
  // it cannot drift out of alignment when the chart is scaled to its
  // container. The width is estimated from the text because SVG has no
  // auto-sizing box.
  const tooltip = (() => {
    if (!activePoint) return null;
    const text = `${activePoint.count} issued on ${activePoint.date}`;
    const width = text.length * 6.2 + 16;
    const centre = centerX(activeIndex as number);
    return {
      text,
      width,
      x: Math.min(
        Math.max(centre - width / 2, 2),
        svgWidth - width - 2,
      ),
      y: Math.max(barTop(activePoint.count) - 28, 2),
    };
  })();

  const description = `Bar chart of certificates issued over time. ${data.length} ${
    data.length === 1 ? "period" : "periods"
  } from ${data[0].date} to ${data[lastIndex].date}. Peak was ${
    peak.count
  } certificates in ${peak.date}.`;

  return (
    <figure className="m-0">
      <div className="overflow-x-auto">
        <div style={{ minWidth: svgWidth }}>
          <svg
            viewBox={`0 0 ${svgWidth} ${chartHeight}`}
            className="h-48 w-full"
            role="img"
            aria-labelledby={`${titleId} ${descId}`}
            onMouseLeave={() => setActiveIndex(null)}
          >
            <title id={titleId}>Certificate issuance over time</title>
            <desc id={descId}>{description}</desc>

            {gridValues.map((value) => {
              const y = padding.top + innerHeight - (value / maxCount) * innerHeight;
              return (
                <g key={value}>
                  <line
                    x1={padding.left}
                    y1={y}
                    x2={svgWidth - padding.right}
                    y2={y}
                    className="stroke-gray-200 dark:stroke-gray-700"
                    strokeWidth={1}
                  />
                  <text
                    x={padding.left - 6}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-gray-400 text-[10px] dark:fill-gray-500"
                  >
                    {value}
                  </text>
                </g>
              );
            })}

            {data.map((point, index) => {
              const x = padding.left + index * (barWidth + gap);
              const isActive = activeIndex === index;
              return (
                <rect
                  key={point.date}
                  x={x}
                  y={barTop(point.count)}
                  width={barWidth}
                  height={(point.count / maxCount) * innerHeight}
                  rx={Math.min(4, barWidth / 2)}
                  className={
                    isActive
                      ? "fill-blue-600 dark:fill-blue-400"
                      : "fill-blue-500/80 dark:fill-blue-500/60"
                  }
                  onMouseEnter={() => setActiveIndex(index)}
                />
              );
            })}

            <line
              x1={padding.left}
              y1={padding.top + innerHeight}
              x2={svgWidth - padding.right}
              y2={padding.top + innerHeight}
              className="stroke-gray-300 dark:stroke-gray-600"
              strokeWidth={1}
            />

            {ticks.map((tick) => (
              <text
                key={tick.x}
                x={tick.x}
                y={chartHeight - 16}
                textAnchor="middle"
                className="fill-gray-500 text-[10px] dark:fill-gray-400"
              >
                {tick.label}
              </text>
            ))}

            <text
              x={padding.left}
              y={chartHeight - 2}
              textAnchor="start"
              className="fill-gray-400 text-[10px] dark:fill-gray-500"
            >
              Issue date
            </text>
            <text
              x={-(padding.top + innerHeight / 2)}
              y={12}
              transform="rotate(-90)"
              textAnchor="middle"
              className="fill-gray-400 text-[10px] dark:fill-gray-500"
            >
              Certificates issued
            </text>
            {tooltip && (
              <g
                pointerEvents="none"
                transform={`translate(${tooltip.x}, ${tooltip.y})`}
              >
                <rect
                  x={0}
                  y={0}
                  width={tooltip.width}
                  height={22}
                  rx={4}
                  className="fill-gray-900 dark:fill-gray-700"
                />
                <text
                  x={tooltip.width / 2}
                  y={15}
                  textAnchor="middle"
                  className="fill-white text-[11px]"
                >
                  {tooltip.text}
                </text>
              </g>
            )}
          </svg>
        </div>
      </div>

      {/* The bars are decoration for assistive tech, which sees the svg as a
          single image. This table is the actual data, and it is what a screen
          reader or a data table gets. */}
      <table className="sr-only">
        <caption>Certificates issued per period</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Certificates issued</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point) => (
            <tr key={`sr-${point.date}`}>
              <th scope="row">{point.date}</th>
              <td>{point.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
};

type StatusPieChartProps = {
  distribution: StatusDistribution;
};

const StatusPieChart = ({ distribution }: StatusPieChartProps) => {
  const total =
    distribution.active + distribution.revoked + distribution.expired;

  if (!total) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-gray-500">
        No certificates to display status distribution.
      </div>
    );
  }

  const radius = 64;
  const center = 80;

  const segments: Array<{
    key: keyof StatusDistribution;
    value: number;
    color: string;
    label: string;
  }> = [
    {
      key: "active" as const,
      value: distribution.active,
      color: "#22c55e",
      label: "Active",
    },
    {
      key: "revoked" as const,
      value: distribution.revoked,
      color: "#ef4444",
      label: "Revoked",
    },
    {
      key: "expired" as const,
      value: distribution.expired,
      color: "#eab308",
      label: "Expired",
    },
  ].filter((segment) => segment.value > 0);

  let startAngle = 0;

  const paths = segments.map((segment) => {
    const angle = (segment.value / total) * 360;
    const endAngle = startAngle + angle;
    const largeArcFlag = angle > 180 ? 1 : 0;

    const startRadians = ((startAngle - 90) * Math.PI) / 180;
    const endRadians = ((endAngle - 90) * Math.PI) / 180;

    const x1 = center + radius * Math.cos(startRadians);
    const y1 = center + radius * Math.sin(startRadians);
    const x2 = center + radius * Math.cos(endRadians);
    const y2 = center + radius * Math.sin(endRadians);

    const d = [
      `M ${center} ${center}`,
      `L ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
      "Z",
    ].join(" ");

    const currentStartAngle = startAngle;
    startAngle = endAngle;

    return { segment, d, startAngle: currentStartAngle, endAngle };
  });

  return (
    <div className="flex items-center gap-4">
      <svg
        viewBox="0 0 160 160"
        className="h-40 w-40"
        aria-label="Certificate status distribution"
      >
        {paths.map(({ segment, d }) => (
          <path key={segment.key} d={d} fill={segment.color} />
        ))}
        <circle cx={center} cy={center} r={28} fill="#ffffff" />
      </svg>
      <div className="space-y-2 text-sm">
        {segments.map((segment) => {
          const percentage = ((segment.value / total) * 100).toFixed(1);
          return (
            <div key={segment.key} className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: segment.color }}
              />
              <span className="text-gray-700">
                {segment.label}{" "}
                <span className="font-semibold text-gray-900">
                  {segment.value}
                </span>{" "}
                <span className="text-gray-500">({percentage}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

type ActivityFeedProps = {
  items: ActivityItem[];
};

const ActivityFeed = ({ items }: ActivityFeedProps) => {
  if (!items.length) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-gray-500">
        No recent activity yet.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-gray-100 text-sm">
      {items.slice(0, 10).map((item, index) => (
        <li
          key={`${item.date}-${index}`}
          className="py-3 flex items-start justify-between"
        >
          <div>
            <p className="font-medium text-gray-900">{item.description}</p>
            <p className="mt-1 text-xs text-gray-500">
              {new Date(item.date).toLocaleString(undefined, {
                year: "numeric",
                month: "short",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
          <span className="ml-4 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize text-white">
            {item.type === "issue" && (
              <span className="rounded-full bg-emerald-500 px-2 py-0.5">
                Issued
              </span>
            )}
            {item.type === "verify" && (
              <span className="rounded-full bg-blue-500 px-2 py-0.5">
                Verified
              </span>
            )}
            {item.type === "revoke" && (
              <span className="rounded-full bg-red-500 px-2 py-0.5">
                Revoked
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
};

const createInitialDateRange = (): DateRange => {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 6);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
};

const getCertificateStatusLabel = (status: Certificate["status"]) => {
  switch (status) {
    case "active":
      return "Active";
    case "revoked":
      return "Revoked";
    case "expired":
      return "Expired";
    case "frozen":
      return "Frozen";
    default:
      return "Unknown";
  }
};

const getCertificateStatusClass = (status: Certificate["status"]) => {
  switch (status) {
    case "active":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300";
    case "revoked":
      return "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300";
    case "expired":
      return "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300";
    case "frozen":
      return "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-300";
  }
};

const formatCertificateDate = (date?: string) => {
  if (!date) return "Unknown";
  return new Date(date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
};

const isExpiringSoon = (certificate: Certificate) => {
  if (!certificate.expiryDate || certificate.status !== "active") return false;

  const expiry = new Date(certificate.expiryDate);
  const threshold = new Date();
  threshold.setDate(threshold.getDate() + 30);
  return expiry <= threshold;
};

type VerifierLookupResult = {
  isValid: boolean;
  message?: string;
  verifiedAt?: string;
  certificate?: {
    title?: string;
    recipientName?: string;
    issuerName?: string;
    issuedDate?: string;
    expiryDate?: string;
    credentialHash?: string;
  };
};

const RecipientDashboard = () => {
  const { user } = useAuth();

  // Same cache entry as the wallet page, so only one of the two routes pays
  // for this request.
  const {
    data: certificates = [],
    isPending: loading,
    isError,
    error: loadError,
  } = useUserCertificatesQuery(user?.id);

  const error = isError
    ? ((loadError as { message?: string } | null)?.message ??
      "Failed to load your certificate wallet")
    : null;

  const summary = useMemo(() => {
    const active = certificates.filter((cert) => cert.status === "active");
    const revoked = certificates.filter((cert) => cert.status === "revoked");
    const expired = certificates.filter((cert) => cert.status === "expired");
    const expiringSoon = certificates.filter(isExpiringSoon);
    const recentCertificates = [...certificates].sort(
      (a, b) =>
        new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime(),
    );

    return {
      total: certificates.length,
      active: active.length,
      revoked: revoked.length,
      expired: expired.length,
      expiringSoon: expiringSoon.length,
      recentCertificates,
    };
  }, [certificates]);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 transition-colors duration-250 dark:text-white">
            Your Certificate Wallet
          </h1>
          <p className="mt-1 text-sm text-gray-500 transition-colors duration-250 dark:text-slate-400">
            See your certificate summary, recent awards, and quick verification
            actions in one place.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/wallet"
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors duration-250 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Wallet className="h-4 w-4" />
            Open wallet
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <MetricCard
          label="Total Certificates"
          value={summary.total}
          accentClassName="text-blue-600"
        />
        <MetricCard
          label="Active"
          value={summary.active}
          accentClassName="text-emerald-600"
        />
        <MetricCard
          label="Expiring Soon"
          value={summary.expiringSoon}
          accentClassName="text-amber-600"
        />
        <MetricCard
          label="Revoked / Expired"
          value={summary.revoked + summary.expired}
          accentClassName="text-red-600"
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[3fr,2fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-md transition-colors duration-250 dark:border-slate-700 dark:bg-slate-900 dark:shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 transition-colors duration-250 dark:text-white">
                Recent certificates
              </h2>
              <p className="mt-1 text-xs text-gray-500 transition-colors duration-250 dark:text-slate-400">
                Your latest certificates and their current status.
              </p>
            </div>
            <Link
              to="/wallet"
              className="text-sm font-medium text-blue-600 transition-colors duration-250 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              View full wallet
            </Link>
          </div>

          <div className="mt-4">
            {loading ? (
              <div className="flex h-48 items-center justify-center text-sm text-gray-500 dark:text-slate-400">
                Loading your certificates...
              </div>
            ) : summary.recentCertificates.length ? (
              <div className="space-y-3">
                {summary.recentCertificates.slice(0, 5).map((certificate) => (
                  <div
                    key={certificate.id}
                    className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 transition-colors duration-250 dark:border-slate-700 dark:bg-slate-800/60 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-gray-900 transition-colors duration-250 dark:text-white">
                          {certificate.title}
                        </p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getCertificateStatusClass(certificate.status)}`}
                        >
                          {getCertificateStatusLabel(certificate.status)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-600 transition-colors duration-250 dark:text-slate-400">
                        Issued by {certificate.issuerName} on{" "}
                        {formatCertificateDate(certificate.issueDate)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-slate-400">
                      {certificate.expiryDate ? (
                        <span>Expires {formatCertificateDate(certificate.expiryDate)}</span>
                      ) : (
                        <span>No expiry date</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-gray-500 transition-colors duration-250 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                <FileText className="mb-3 h-6 w-6 text-slate-400" />
                No certificates have been added to your wallet yet.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-md transition-colors duration-250 dark:border-slate-700 dark:bg-slate-900 dark:shadow-lg">
            <h2 className="text-lg font-semibold text-gray-900 transition-colors duration-250 dark:text-white">
              Quick actions
            </h2>
            <div className="mt-4 space-y-3">
              <Link
                to="/wallet"
                className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-800 transition-colors duration-250 hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <span>Open wallet</span>
                <Wallet className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </Link>
              <Link
                to="/verify"
                className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-800 transition-colors duration-250 hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <span>Verify a certificate</span>
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-md transition-colors duration-250 dark:border-slate-700 dark:bg-slate-900 dark:shadow-lg">
            <h2 className="text-lg font-semibold text-gray-900 transition-colors duration-250 dark:text-white">
              Wallet insights
            </h2>
            <ul className="mt-4 space-y-3 text-sm text-gray-600 transition-colors duration-250 dark:text-slate-400">
              <li className="flex items-start gap-3">
                <BadgeCheck className="mt-0.5 h-4 w-4 text-emerald-500" />
                Keep the wallet page bookmarked for quick access to your
                certificates.
              </li>
              <li className="flex items-start gap-3">
                <BookOpen className="mt-0.5 h-4 w-4 text-blue-500" />
                Use the verify page to confirm certificate authenticity with a
                serial number or hash.
              </li>
              <li className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-amber-500" />
                Review expiry dates regularly so you do not miss certificates
                that need renewal.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

const VerifierDashboard = () => {
  const [lookupValue, setLookupValue] = useState("");
  const [verificationError, setVerificationError] = useState<string | null>(
    null,
  );
  const verifyMutation = useVerifyCertificateMutation();
  const verificationResult = verifyMutation.data as VerifierLookupResult | undefined;
  const verifying = verifyMutation.isPending;

  const handleVerify = () => {
    const trimmed = lookupValue.trim();
    if (!trimmed) {
      setVerificationError("Enter a certificate ID or hash to verify.");
      return;
    }

    setVerificationError(null);
    verifyMutation.mutate(trimmed, {
      onError: (err) => {
        setVerificationError(
          err && typeof err === "object" && "message" in err
            ? String((err as { message?: string }).message)
            : "Verification failed. Please try again.",
        );
      },
    });
  };

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 transition-colors duration-250 dark:text-white">
            Verification Center
          </h1>
          <p className="mt-1 text-sm text-gray-500 transition-colors duration-250 dark:text-slate-400">
            Quickly check certificate authenticity and jump into verification
            workflows.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/verify"
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors duration-250 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Search className="h-4 w-4" />
            Open verifier
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr,2fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-md transition-colors duration-250 dark:border-slate-700 dark:bg-slate-900 dark:shadow-lg">
          <h2 className="text-lg font-semibold text-gray-900 transition-colors duration-250 dark:text-white">
            Verify a certificate
          </h2>
          <p className="mt-1 text-xs text-gray-500 transition-colors duration-250 dark:text-slate-400">
            Enter a serial number, certificate ID, or hash to verify it here.
          </p>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={lookupValue}
              onChange={(event) => setLookupValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleVerify();
                }
              }}
              placeholder="e.g. CERT-2024-XXXXXXXX"
              className="flex-1 rounded-md border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm transition-colors duration-250 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
            <button
              type="button"
              onClick={() => void handleVerify()}
              disabled={verifying}
              className="inline-flex items-center justify-center rounded-md bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors duration-250 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-700 dark:hover:bg-blue-600"
            >
              {verifying ? "Verifying..." : "Verify"}
            </button>
          </div>

          {verificationError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-500/10 dark:text-red-300">
              {verificationError}
            </div>
          )}

          {verificationResult && (
            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-5 transition-colors duration-250 dark:border-slate-700 dark:bg-slate-800/60">
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full ${verificationResult.isValid ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"}`}
                >
                  {verificationResult.isValid ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <ShieldAlert className="h-5 w-5" />
                  )}
                </span>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 transition-colors duration-250 dark:text-white">
                    {verificationResult.isValid
                      ? "Certificate verified"
                      : "Certificate could not be verified"}
                  </h3>
                  {verificationResult.verifiedAt && (
                    <p className="text-xs text-gray-500 transition-colors duration-250 dark:text-slate-400">
                      Verified at{" "}
                      {new Date(verificationResult.verifiedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>

              {verificationResult.message && (
                <p className="mt-4 text-sm text-gray-600 transition-colors duration-250 dark:text-slate-300">
                  {verificationResult.message}
                </p>
              )}

              {verificationResult.certificate && (
                <div className="mt-4 grid grid-cols-1 gap-3 text-sm text-gray-600 transition-colors duration-250 dark:text-slate-300 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      Title
                    </p>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {verificationResult.certificate.title ?? "Unknown"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      Recipient
                    </p>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {verificationResult.certificate.recipientName ?? "Unknown"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      Issuer
                    </p>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {verificationResult.certificate.issuerName ?? "Unknown"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      Issued
                    </p>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {formatCertificateDate(
                        verificationResult.certificate.issuedDate,
                      )}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-md transition-colors duration-250 dark:border-slate-700 dark:bg-slate-900 dark:shadow-lg">
            <h2 className="text-lg font-semibold text-gray-900 transition-colors duration-250 dark:text-white">
              Quick actions
            </h2>
            <div className="mt-4 space-y-3">
              <Link
                to="/verify"
                className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-800 transition-colors duration-250 hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <span>Open verification page</span>
                <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </Link>
              <Link
                to="/wallet"
                className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-800 transition-colors duration-250 hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <span>Open wallet</span>
                <Wallet className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-md transition-colors duration-250 dark:border-slate-700 dark:bg-slate-900 dark:shadow-lg">
            <h2 className="text-lg font-semibold text-gray-900 transition-colors duration-250 dark:text-white">
              Verifier checklist
            </h2>
            <ul className="mt-4 space-y-3 text-sm text-gray-600 transition-colors duration-250 dark:text-slate-400">
              <li className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-500" />
                Verify with a serial number or credential hash before sharing
                certificate details.
              </li>
              <li className="flex items-start gap-3">
                <BadgeCheck className="mt-0.5 h-4 w-4 text-blue-500" />
                Use the verification page for a full, dedicated certificate
                authenticity flow.
              </li>
              <li className="flex items-start gap-3">
                <BookOpen className="mt-0.5 h-4 w-4 text-amber-500" />
                Keep notes about the context of the verification for auditing
                and compliance.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

const IssuerDashboard = () => {
  // `dateRange` is the editor's draft; `appliedDateRange` is what the query is
  // keyed on. Keeping them separate preserves the original behaviour where
  // nothing is fetched until Apply is pressed — keying the query on the draft
  // would fire a request per date edit.
  const [dateRange, setDateRange] = useState<DateRange>(createInitialDateRange);
  const [appliedDateRange, setAppliedDateRange] = useState<DateRange>(
    createInitialDateRange,
  );
  const [filterDirty, setFilterDirty] = useState(false);

  const {
    data: stats = null,
    isPending,
    isFetching,
    isError,
    error: loadError,
  } = useDashboardSummaryQuery(appliedDateRange);

  const loading = isPending || isFetching;
  const error = isError
    ? ((loadError as { message?: string } | null)?.message ??
      "Failed to load analytics")
    : null;
  const revokedCount = stats?.revokedCertificates ?? 0;

  const statusDistribution: StatusDistribution = useMemo(() => {
    if (stats?.statusDistribution) {
      return stats.statusDistribution;
    }

    return {
      active: stats?.activeCertificates ?? 0,
      revoked: stats?.revokedCertificates ?? 0,
      expired: stats?.expiredCertificates ?? 0,
    };
  }, [stats]);

  const handleDateChange = (field: keyof DateRange, value: string) => {
    setDateRange((prev) => ({
      ...prev,
      [field]: value,
    }));
    setFilterDirty(true);
  };

  // Apply promotes the draft to the applied range, which is what re-keys the
  // query. The fetch, loading flag and error state all come from the query layer.
  const handleApplyFilters = () => {
    setAppliedDateRange((prev) =>
      prev.startDate === dateRange.startDate &&
      prev.endDate === dateRange.endDate
        ? prev
        : dateRange,
    );
    setFilterDirty(false);
  };

  const handleResetFilters = () => {
    const initial = createInitialDateRange();
    setDateRange(initial);
    setAppliedDateRange(initial);
    setFilterDirty(false);
  };

  const handleExportCsv = () => {
    if (!stats) return;

    const rows: string[][] = [];

    rows.push(["Metric", "Value"]);
    rows.push(["Total Certificates", String(stats.totalCertificates)]);
    rows.push(["Active Certificates", String(statusDistribution.active)]);
    rows.push(["Revoked Certificates", String(statusDistribution.revoked)]);
    rows.push(["Expired Certificates", String(statusDistribution.expired)]);
    rows.push(["Total Verifications", String(stats.totalVerifications)]);
    rows.push(["Verifications (24h)", String(stats.verifications24h)]);
    rows.push([]);

    rows.push(["Issuance Date", "Certificates Issued"]);
    (stats.issuanceTrend ?? []).forEach((point) => {
      rows.push([point.date, String(point.count)]);
    });
    rows.push([]);

    rows.push(["Status", "Count"]);
    rows.push(["Active", String(statusDistribution.active)]);
    rows.push(["Revoked", String(statusDistribution.revoked)]);
    rows.push(["Expired", String(statusDistribution.expired)]);

    const csvContent = rows
      .map((row) =>
        row
          .map((field) => {
            const value = String(field).replace(/"/g, '""');
            return `"${value}"`;
          })
          .join(","),
      )
      .join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "issuer-analytics.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white transition-colors duration-250">
            Issuer Analytics Dashboard
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400 transition-colors duration-250">
            Track certificate issuance trends, status distribution, and recent
            issuer activity.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!stats}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 transition-colors duration-250"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="mb-6 grid gap-4 rounded-lg bg-white dark:bg-slate-900 p-4 shadow-sm dark:shadow-lg dark:border dark:border-slate-700 md:grid-cols-[2fr,3fr] transition-colors duration-250">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 transition-colors duration-250">
            Date range
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-col">
              <label
                htmlFor="startDate"
                className="text-xs font-medium text-gray-500 dark:text-slate-400 transition-colors duration-250"
              >
                Start
              </label>
              <input
                id="startDate"
                type="date"
                value={dateRange.startDate}
                onChange={(e) => handleDateChange("startDate", e.target.value)}
                className="mt-1 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-sm text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors duration-250"
              />
            </div>
            <div className="flex flex-col">
              <label
                htmlFor="endDate"
                className="text-xs font-medium text-gray-500 dark:text-slate-400 transition-colors duration-250"
              >
                End
              </label>
              <input
                id="endDate"
                type="date"
                value={dateRange.endDate}
                onChange={(e) => handleDateChange("endDate", e.target.value)}
                className="mt-1 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-sm text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors duration-250"
              />
            </div>
            <div className="mt-4 flex items-center gap-2 md:mt-6">
              <button
                type="button"
                onClick={handleApplyFilters}
                disabled={
                  loading ||
                  !dateRange.startDate ||
                  !dateRange.endDate ||
                  !filterDirty
                }
                className="rounded-md bg-blue-600 dark:bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 dark:hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60 transition-colors duration-250"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={handleResetFilters}
                disabled={loading}
                className="rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 transition-colors duration-250"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-4 text-xs text-gray-500 dark:text-slate-400 transition-colors duration-250">
          {loading && <span>Loading analytics…</span>}
          {error && !loading && (
            <span className="text-red-500 dark:text-red-400 transition-colors duration-250">
              {error}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
        <MetricCard
          label="Total Certificates"
          value={stats?.totalCertificates ?? 0}
          accentClassName="text-blue-600"
        />
        <MetricCard
          label="Active Certificates"
          value={statusDistribution.active}
          accentClassName="text-emerald-600"
        />
        <MetricCard
          label="Revoked Certificates"
          value={statusDistribution.revoked}
          accentClassName="text-red-600"
        />
        <MetricCard
          label="Verifications (24h)"
          value={stats?.verifications24h ?? 0}
          accentClassName="text-purple-600"
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-lg bg-white dark:bg-slate-900 p-6 shadow-md dark:shadow-lg dark:border dark:border-slate-700 transition-colors duration-250">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white transition-colors duration-250">
            Issuance over time
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400 transition-colors duration-250">
            Daily certificate issuance for the selected date range.
          </p>
          <div className="mt-4">
            <IssuanceChart data={stats?.issuanceTrend ?? []} />
          </div>
        </div>
        <div className="rounded-lg bg-white dark:bg-slate-900 p-6 shadow-md dark:shadow-lg dark:border dark:border-slate-700 transition-colors duration-250">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white transition-colors duration-250">
            Status distribution
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400 transition-colors duration-250">
            Breakdown of certificates by current status.
          </p>
          <div className="mt-4">
            <StatusPieChart distribution={statusDistribution} />
          </div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[3fr,2fr]">
        <div className="rounded-lg bg-white dark:bg-slate-900 p-6 shadow-md dark:shadow-lg dark:border dark:border-slate-700 transition-colors duration-250">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white transition-colors duration-250">
            Recent activity
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400 transition-colors duration-250">
            Latest certificate issuance and revocation events.
          </p>
          <div className="mt-4">
            <ActivityFeed items={stats?.recentActivity ?? []} />
          </div>
        </div>
        <div className="rounded-lg bg-white dark:bg-slate-900 p-6 shadow-md dark:shadow-lg dark:border dark:border-slate-700 transition-colors duration-250">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white transition-colors duration-250">
            Quick actions
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400 transition-colors duration-250">
            Common issuer workflows you can access from here.
          </p>
          <div className="mt-4 space-y-3">
            <Link
              to="/issue"
              className="flex items-center justify-between rounded-md border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-4 py-3 text-sm font-medium text-gray-800 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors duration-250"
            >
              <span>Issue new certificate</span>
              <Award className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </Link>
            <Link
              to="/verify"
              className="flex items-center justify-between rounded-md border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-4 py-3 text-sm font-medium text-gray-800 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors duration-250"
            >
              <span>Verify existing certificate</span>
              <Search className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </Link>
            <Link
              to="/wallet"
              className="flex items-center justify-between rounded-md border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-4 py-3 text-sm font-medium text-gray-800 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors duration-250"
            >
              <span>Open certificate wallet</span>
              <Wallet className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-6">
        <Link
          to="/issue"
          className="bg-white dark:bg-slate-900 p-6 rounded-lg shadow-md dark:shadow-lg dark:border dark:border-slate-700 hover:shadow-lg dark:hover:shadow-xl transition-all duration-250"
        >
          <Award className="w-12 h-12 text-blue-600 dark:text-blue-400 mb-4 transition-colors duration-250" />
          <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white transition-colors duration-250">
            Issue Certificate
          </h3>
          <p className="text-sm text-gray-600 dark:text-slate-400 transition-colors duration-250">
            Create and issue new digital certificates
          </p>
        </Link>

        <Link
          to="/verify"
          className="bg-white dark:bg-slate-900 p-6 rounded-lg shadow-md dark:shadow-lg dark:border dark:border-slate-700 hover:shadow-lg dark:hover:shadow-xl transition-all duration-250"
        >
          <Search className="w-12 h-12 text-green-600 dark:text-green-400 mb-4 transition-colors duration-250" />
          <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white transition-colors duration-250">
            Verify Certificate
          </h3>
          <p className="text-sm text-gray-600 dark:text-slate-400 transition-colors duration-250">
            Verify the authenticity of certificates
          </p>
        </Link>

        <Link
          to="/wallet"
          className="bg-white dark:bg-slate-900 p-6 rounded-lg shadow-md dark:shadow-lg dark:border dark:border-slate-700 hover:shadow-lg dark:hover:shadow-xl transition-all duration-250"
        >
          <Wallet className="w-12 h-12 text-purple-600 dark:text-purple-400 mb-4 transition-colors duration-250" />
          <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white transition-colors duration-250">
            Certificate Wallet
          </h3>
          <p className="text-sm text-gray-600 dark:text-slate-400 transition-colors duration-250">
            View and manage your certificates
          </p>
        </Link>

        <Link
          to="/revoke"
          className="bg-white dark:bg-slate-900 p-6 rounded-lg shadow-md dark:shadow-lg border border-red-200 dark:border-red-900/50 hover:shadow-lg dark:hover:shadow-xl transition-all duration-250"
        >
          <ShieldAlert className="w-12 h-12 text-red-600 dark:text-red-400 mb-4 transition-colors duration-250" />
          <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white transition-colors duration-250">
            Revoke Certificate
          </h3>
          <p className="text-sm text-gray-600 dark:text-slate-400 transition-colors duration-250">
            Manage certificate revocation list
          </p>
          <div className="mt-2 text-sm text-red-600 dark:text-red-400 font-medium transition-colors duration-250">
            CRL Active • {revokedCount} revoked
          </div>
        </Link>
      </div>
    </div>
  );
};

const Dashboard = () => {
  const { user } = useAuth();

  if (user?.role === UserRole.ADMIN) {
    return <AdminAnalyticsDashboard />;
  }

  if (user?.role === UserRole.RECIPIENT) {
    return <RecipientDashboard />;
  }

  if (user?.role === UserRole.VERIFIER) {
    return <VerifierDashboard />;
  }

  return <IssuerDashboard />;
};

export default Dashboard;
