import { useId, useState } from "react";
import type {
  Certificate,
  IssuanceTrendPoint,
  StatusDistribution,
} from "../../api";

export type DateRange = {
  startDate: string;
  endDate: string;
};

type MetricCardProps = {
  label: string;
  value: number;
  accentClassName: string;
};

export const MetricCard = ({
  label,
  value,
  accentClassName,
}: MetricCardProps) => (
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

export const IssuanceChart = ({ data }: IssuanceChartProps) => {
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
  const idealBarWidth = (innerWidth - gap * (data.length - 1)) / data.length;
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
  const finalTick = {
    x: centerX(lastIndex),
    label: formatPeriodLabel(data[lastIndex].date),
  };
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
      x: Math.min(Math.max(centre - width / 2, 2), svgWidth - width - 2),
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
              const y =
                padding.top + innerHeight - (value / maxCount) * innerHeight;
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

export const StatusPieChart = ({ distribution }: StatusPieChartProps) => {
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
  items: import("../../api").ActivityItem[];
};

export const ActivityFeed = ({ items }: ActivityFeedProps) => {
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

export const createInitialDateRange = (): DateRange => {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 6);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
};

export const getCertificateStatusLabel = (status: Certificate["status"]) => {
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

export const getCertificateStatusClass = (status: Certificate["status"]) => {
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

export const formatCertificateDate = (date?: string) => {
  if (!date) return "Unknown";
  return new Date(date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
};

export const isExpiringSoon = (certificate: Certificate) => {
  if (!certificate.expiryDate || certificate.status !== "active") return false;

  const expiry = new Date(certificate.expiryDate);
  const threshold = new Date();
  threshold.setDate(threshold.getDate() + 30);
  return expiry <= threshold;
};

export type VerifierLookupResult = {
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
