"use client";
/**
 * Tiny dependency-free SVG charts for the Personal Finance overview. Responsive
 * (100% width via viewBox), clean, emerald-led palette, mobile-first. No chart
 * library — these three shapes cover the whole overview.
 */

/** Distinct, readable category colors (emerald leads the PF accent). */
export const PF_PALETTE = [
  "#059669", "#0ea5e9", "#f59e0b", "#f43f5e", "#8b5cf6",
  "#14b8a6", "#84cc16", "#fb923c", "#ec4899", "#6366f1", "#94a3b8",
];

/** Donut for spending-by-category. Renders nothing when empty. */
export function Donut({ slices, size = 132, thickness = 18 }: { slices: { label: string; value: number }[]; size?: number; thickness?: number }) {
  const data = slices.filter((s) => s.value > 0);
  const total = data.reduce((a, s) => a + s.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  if (total <= 0) return null;
  let start = 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full max-w-[180px]" role="img" aria-label="Spending by category">
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="#f1f5f9" strokeWidth={thickness} />
      {data.map((s, i) => {
        const frac = s.value / total;
        const seg = frac * c;
        const el = (
          <circle
            key={i}
            cx={cx}
            cy={cx}
            r={r}
            fill="none"
            stroke={PF_PALETTE[i % PF_PALETTE.length]}
            strokeWidth={thickness}
            strokeDasharray={`${seg} ${c}`}
            transform={`rotate(${start * 360 - 90} ${cx} ${cx})`}
            strokeLinecap="butt"
          />
        );
        start += frac;
        return el;
      })}
    </svg>
  );
}

/** Grouped income-vs-expense bars per period bucket. */
export function IncomeExpenseBars({ data, height = 120 }: { data: { label: string; income: number; expense: number }[]; height?: number }) {
  const n = Math.max(data.length, 1);
  const slot = 44;
  const width = n * slot;
  const max = Math.max(1, ...data.map((d) => Math.max(d.income, d.expense)));
  const barW = 14;
  const gap = 4;
  const chartH = height - 18;
  const y = (v: number) => chartH - (v / max) * chartH;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[130px]" style={{ width: Math.max(width, 260) }} role="img" aria-label="Income versus expense">
        {data.map((d, i) => {
          const x = i * slot + (slot - (barW * 2 + gap)) / 2;
          return (
            <g key={i}>
              <rect x={x} y={y(d.income)} width={barW} height={chartH - y(d.income)} rx={2} fill="#059669" />
              <rect x={x + barW + gap} y={y(d.expense)} width={barW} height={chartH - y(d.expense)} rx={2} fill="#f43f5e" />
              <text x={i * slot + slot / 2} y={height - 4} textAnchor="middle" className="fill-gray-400" fontSize="9">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Net-per-period area/line trend. */
export function NetTrend({ data, height = 90 }: { data: { label: string; net: number }[]; height?: number }) {
  const n = data.length;
  if (n < 2) return null;
  const width = 300;
  const pad = 8;
  const vals = data.map((d) => d.net);
  const max = Math.max(...vals, 0);
  const min = Math.min(...vals, 0);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (width - 2 * pad)) / (n - 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - 2 * pad);
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.net).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${height - pad} L${x(0).toFixed(1)},${height - pad} Z`;
  const zeroY = y(0);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[90px] w-full" role="img" aria-label="Net trend">
      <line x1={pad} y1={zeroY} x2={width - pad} y2={zeroY} stroke="#e5e7eb" strokeWidth={1} strokeDasharray="3 3" />
      <path d={area} fill="#05966915" />
      <path d={line} fill="none" stroke="#059669" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <circle key={i} cx={x(i)} cy={y(d.net)} r={2.5} fill="#059669" />
      ))}
    </svg>
  );
}
