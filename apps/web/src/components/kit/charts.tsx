"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TONE_DOT, toTone, type AnyTone } from "./badge";

/* ---------------------------------------------------------------- */
/* Shared                                                            */
/* ---------------------------------------------------------------- */

/** Categorical series colours in fixed order (indigo, sky, emerald, amber, rose, slate). Never cycle past 6. */
export const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
/** Status colours for charts that show state (present/late/absent...). */
export const STATUS_COLORS = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  info: "var(--info)",
  neutral: "var(--chart-6)",
  primary: "var(--chart-1)",
} as const;

const fmtDefault = (n: number) => n.toLocaleString("en-PK", { maximumFractionDigits: 1 });

/** A round step (1, 2, 2.5 or 5 x 10^k) at least `v`; whole numbers only when `integer`. */
function niceStep(v: number, integer: boolean): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 && (!integer || exp >= 10) ? 2.5 : f <= 5 ? 5 : 10;
  return integer ? Math.max(1, nf * exp) : nf * exp;
}

/**
 * Y axis ticks: round steps from `min` up to a max covering `dataMax`.
 * Whole-number data (counts) gets whole-number ticks. A forced `fixedMax` is split into quarters.
 */
function axisTicks(dataMax: number, min: number, fixedMax: number | undefined, integer: boolean): { max: number; ticks: number[] } {
  if (fixedMax !== undefined) {
    const max = fixedMax > min ? fixedMax : min + 1;
    return { max, ticks: [0, 0.25, 0.5, 0.75, 1].map((t) => min + t * (max - min)) };
  }
  const span = Math.max(dataMax - min, integer ? 1 : 0);
  if (span <= 0) return { max: min + 1, ticks: [min, min + 1] };
  const step = niceStep(span / 4, integer);
  const count = Math.max(1, Math.ceil(span / step - 1e-9));
  const ticks = Array.from({ length: count + 1 }, (_, i) => min + i * step);
  return { max: ticks[ticks.length - 1], ticks };
}

/** Rough rendered width of an 11px axis label. */
const labelWidth = (s: string) => s.length * 6.4;

/** Left padding that fits the longest y tick label. */
function leftPad(labels: string[]): number {
  return Math.min(120, Math.max(28, Math.ceil(Math.max(0, ...labels.map(labelWidth)) + 12)));
}

/** Show every Nth category label so labels do not run into each other. */
function labelStep(categories: string[], plotW: number): number {
  if (!categories.length || plotW <= 0) return 1;
  const widest = Math.max(...categories.map(labelWidth)) + 10;
  return Math.max(1, Math.ceil(categories.length / Math.max(1, Math.floor(plotW / widest))));
}

const allIntegers = (series: ChartSeries[]) => series.every((s) => s.values.every((v) => Number.isInteger(v)));

/** Container width via ResizeObserver (0 until measured). */
function useWidth<E extends HTMLElement>(): [(el: E | null) => void, number] {
  const [width, setWidth] = useState(0);
  const obs = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: E | null) => {
    obs.current?.disconnect();
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    obs.current = ro;
  }, []);
  return [ref, width];
}

export interface LegendItem {
  label: ReactNode;
  color: string;
  value?: ReactNode;
}

/** Colour key. Always shown for 2+ series so colour is never the only cue. */
export function Legend({ items, className, vertical }: { items: LegendItem[]; className?: string; vertical?: boolean }) {
  return (
    <ul className={cn("flex text-xs text-fg-secondary", vertical ? "flex-col gap-2" : "flex-wrap gap-x-4 gap-y-1.5", className)}>
      {items.map((it, i) => (
        <li key={i} className="flex min-w-0 items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-sm" style={{ background: it.color }} aria-hidden />
          <span className="truncate">{it.label}</span>
          {it.value !== undefined && <span className="ms-auto ps-2 font-medium tabular-nums text-fg">{it.value}</span>}
        </li>
      ))}
    </ul>
  );
}

function Tip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-fg shadow-overlay"
      style={{ left: x, top: y - 8 }}
    >
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Donut                                                             */
/* ---------------------------------------------------------------- */

export interface DonutSlice {
  label: string;
  value: number;
  color?: string;
}

export interface DonutChartProps {
  data: DonutSlice[];
  /** Accessible summary, e.g. "Attendance today". */
  label: string;
  size?: number;
  thickness?: number;
  /** Big text in the middle (e.g. "92.4%"). */
  centerValue?: ReactNode;
  centerLabel?: ReactNode;
  showLegend?: boolean;
  formatValue?: (n: number) => string;
  className?: string;
}

export function DonutChart({ data, label, size = 160, thickness = 18, centerValue, centerLabel, showLegend = true, formatValue = fmtDefault, className }: DonutChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const gap = data.filter((d) => d.value > 0).length > 1 ? 2 : 0;
  let offset = 0;
  const summary = `${label}: ${data.map((d) => `${d.label} ${formatValue(d.value)}`).join(", ")}`;
  return (
    <div className={cn("flex flex-wrap items-center gap-6", className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={summary} className="-rotate-90">
          <title>{summary}</title>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--chart-track)" strokeWidth={thickness} />
          {total > 0 &&
            data.map((d, i) => {
              const len = (Math.max(0, d.value) / total) * c;
              const dash = Math.max(0, len - gap);
              const el = (
                <circle
                  key={d.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={d.color ?? CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={hover === i ? thickness + 3 : thickness}
                  strokeDasharray={`${dash} ${c - dash}`}
                  strokeDashoffset={-offset}
                  className="transition-[stroke-width] duration-150"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>{`${d.label}: ${formatValue(d.value)}`}</title>
                </circle>
              );
              offset += len;
              return el;
            })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {hover !== null ? (
            <>
              <span className="font-display text-xl font-semibold tabular-nums text-fg">{formatValue(data[hover].value)}</span>
              <span className="max-w-[70%] truncate text-xs text-fg-muted">{data[hover].label}</span>
            </>
          ) : (
            <>
              {centerValue !== undefined && <span className="font-display text-xl font-semibold tabular-nums text-fg">{centerValue}</span>}
              {centerLabel && <span className="text-xs text-fg-muted">{centerLabel}</span>}
            </>
          )}
        </div>
      </div>
      {showLegend && (
        <Legend
          vertical
          className="min-w-36 flex-1"
          items={data.map((d, i) => ({ label: d.label, color: d.color ?? CHART_COLORS[i % CHART_COLORS.length], value: formatValue(d.value) }))}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Bar chart (grouped or stacked)                                    */
/* ---------------------------------------------------------------- */

export interface ChartSeries {
  name: string;
  values: number[];
  color?: string;
}

export interface BarChartProps {
  /** X-axis labels (e.g. Mon..Fri). */
  categories: string[];
  series: ChartSeries[];
  label: string;
  stacked?: boolean;
  height?: number;
  formatValue?: (n: number) => string;
  /** Force the y-axis maximum (e.g. 100 for percentages). */
  yMax?: number;
  showLegend?: boolean;
  className?: string;
}

const PAD = { top: 12, right: 8, bottom: 26 };

export function BarChart({ categories, series, label, stacked, height = 220, formatValue = fmtDefault, yMax, showLegend = true, className }: BarChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const totals = categories.map((_, ci) => series.reduce((s, se) => s + (se.values[ci] ?? 0), 0));
  const rawMax = stacked ? Math.max(0, ...totals) : Math.max(0, ...series.flatMap((s) => s.values));
  const { max, ticks } = axisTicks(rawMax, 0, yMax, allIntegers(series));
  const padLeft = leftPad(ticks.map(formatValue));
  const plotW = Math.max(0, width - padLeft - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const band = categories.length ? plotW / categories.length : 0;
  const labelEvery = labelStep(categories, plotW);
  const groupW = Math.min(band * 0.7, stacked ? 36 : 22 * series.length + 4 * (series.length - 1));
  const barW = stacked ? groupW : Math.max(2, (groupW - 3 * (series.length - 1)) / Math.max(1, series.length));
  const y = (v: number) => plotH - (v / max) * plotH;
  const colorOf = (i: number) => series[i].color ?? CHART_COLORS[i % CHART_COLORS.length];
  const summary = `${label}. ${categories.map((c, ci) => `${c}: ${series.map((s) => `${s.name} ${formatValue(s.values[ci] ?? 0)}`).join(", ")}`).join("; ")}`;

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={summary} onMouseLeave={() => setHover(null)}>
            <title>{summary}</title>
            <g transform={`translate(${padLeft},${PAD.top})`}>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeDasharray={t === 0 ? undefined : "3 3"} />
                  <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-fg-muted text-[11px] tabular-nums">
                    {formatValue(t)}
                  </text>
                </g>
              ))}
              {categories.map((cat, ci) => {
                const gx = ci * band + (band - groupW) / 2;
                let acc = 0;
                return (
                  <g key={cat} onMouseEnter={() => setHover(ci)}>
                    <rect x={ci * band} y={0} width={band} height={plotH} fill={hover === ci ? "var(--chart-track)" : "transparent"} opacity={0.6} />
                    {series.map((s, si) => {
                      const v = s.values[ci] ?? 0;
                      if (v <= 0) return null;
                      let x: number, top: number, h: number;
                      if (stacked) {
                        x = gx;
                        top = y(acc + v);
                        h = y(acc) - y(acc + v);
                        acc += v;
                        h = Math.max(0, h - (si > 0 ? 2 : 0));
                      } else {
                        x = gx + si * (barW + 3);
                        top = y(v);
                        h = plotH - top;
                      }
                      const isTop = !stacked || series.slice(si + 1).every((o) => (o.values[ci] ?? 0) <= 0);
                      const rr = Math.min(4, barW / 2, h);
                      return (
                        <path
                          key={s.name}
                          d={isTop ? roundedTop(x, top, barW, h, rr) : `M${x},${top}h${barW}v${h}h${-barW}Z`}
                          fill={colorOf(si)}
                        />
                      );
                    })}
                    {ci % labelEvery === 0 && (
                      <text x={ci * band + band / 2} y={plotH + 17} textAnchor="middle" className="fill-fg-muted text-[11px]">
                        {cat}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        )}
        {hover !== null && width > 0 && (
          <Tip x={padLeft + hover * band + band / 2} y={PAD.top + y(stacked ? totals[hover] : Math.max(...series.map((s) => s.values[hover] ?? 0)))}>
            <p className="mb-1 font-medium">{categories[hover]}</p>
            {series.map((s, si) => (
              <p key={s.name} className="flex items-center gap-2 text-fg-secondary">
                <span className="size-2 rounded-sm" style={{ background: colorOf(si) }} />
                {s.name}
                <span className="ms-auto ps-3 font-medium tabular-nums text-fg">{formatValue(s.values[hover] ?? 0)}</span>
              </p>
            ))}
          </Tip>
        )}
      </div>
      {showLegend && series.length > 1 && <Legend items={series.map((s, i) => ({ label: s.name, color: colorOf(i) }))} />}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return "";
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/* ---------------------------------------------------------------- */
/* Line / Area                                                       */
/* ---------------------------------------------------------------- */

export interface LineChartProps {
  categories: string[];
  series: ChartSeries[];
  label: string;
  /** Fill under each line (AreaChart). */
  area?: boolean;
  height?: number;
  formatValue?: (n: number) => string;
  yMax?: number;
  /** Start the y axis at the data minimum instead of 0. */
  yMin?: number;
  showLegend?: boolean;
  className?: string;
}

export function LineChart({ categories, series, label, area, height = 220, formatValue = fmtDefault, yMax, yMin = 0, showLegend = true, className }: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, "");
  const { max, ticks } = axisTicks(Math.max(yMin, ...series.flatMap((s) => s.values)), yMin, yMax, allIntegers(series) && Number.isInteger(yMin));
  const padLeft = leftPad(ticks.map(formatValue));
  const plotW = Math.max(0, width - padLeft - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const n = categories.length;
  const x = (i: number) => (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => plotH - ((v - yMin) / (max - yMin || 1)) * plotH;
  const colorOf = (i: number) => series[i].color ?? CHART_COLORS[i % CHART_COLORS.length];
  const labelEvery = labelStep(categories, plotW);
  const summary = `${label}. ${series.map((s) => `${s.name}: ${s.values.map((v, i) => `${categories[i]} ${formatValue(v)}`).join(", ")}`).join("; ")}`;

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    setHover(n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((px / plotW) * (n - 1)))));
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={summary}>
            <title>{summary}</title>
            <defs>
              {series.map((s, si) => (
                <linearGradient key={s.name} id={`${gid}-${si}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={colorOf(si)} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={colorOf(si)} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <g transform={`translate(${padLeft},${PAD.top})`}>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeDasharray={t === yMin ? undefined : "3 3"} />
                  <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-fg-muted text-[11px] tabular-nums">
                    {formatValue(t)}
                  </text>
                </g>
              ))}
              {categories.map((c, i) =>
                i % labelEvery === 0 ? (
                  <text key={c + i} x={x(i)} y={plotH + 17} textAnchor="middle" className="fill-fg-muted text-[11px]">
                    {c}
                  </text>
                ) : null,
              )}
              {series.map((s, si) => {
                const pts = s.values.map((v, i) => `${x(i)},${y(v)}`);
                const line = `M${pts.join("L")}`;
                return (
                  <g key={s.name}>
                    {area && <path d={`${line}L${x(s.values.length - 1)},${plotH}L${x(0)},${plotH}Z`} fill={`url(#${gid}-${si})`} />}
                    <path d={line} fill="none" stroke={colorOf(si)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  </g>
                );
              })}
              {hover !== null && (
                <g>
                  <line x1={x(hover)} x2={x(hover)} y1={0} y2={plotH} stroke="var(--chart-axis)" strokeDasharray="3 3" />
                  {series.map((s, si) => (
                    <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4} fill={colorOf(si)} stroke="var(--surface)" strokeWidth={2} />
                  ))}
                </g>
              )}
              <rect x={0} y={0} width={plotW} height={plotH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
            </g>
          </svg>
        )}
        {hover !== null && width > 0 && (
          <Tip x={padLeft + x(hover)} y={PAD.top + Math.min(...series.map((s) => y(s.values[hover] ?? 0)))}>
            <p className="mb-1 font-medium">{categories[hover]}</p>
            {series.map((s, si) => (
              <p key={s.name} className="flex items-center gap-2 text-fg-secondary">
                <span className="size-2 rounded-sm" style={{ background: colorOf(si) }} />
                {s.name}
                <span className="ms-auto ps-3 font-medium tabular-nums text-fg">{formatValue(s.values[hover] ?? 0)}</span>
              </p>
            ))}
          </Tip>
        )}
      </div>
      {showLegend && series.length > 1 && <Legend items={series.map((s, i) => ({ label: s.name, color: colorOf(i) }))} />}
    </div>
  );
}

/** LineChart with filled areas. */
export function AreaChart(props: Omit<LineChartProps, "area">) {
  return <LineChart {...props} area />;
}

/* ---------------------------------------------------------------- */
/* Sparkline                                                         */
/* ---------------------------------------------------------------- */

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  /** Accessible description; without it the sparkline is decorative. */
  label?: string;
  area?: boolean;
  className?: string;
}

/** Tiny trend line for KPI cards. Last point is marked. */
export function Sparkline({ data, width = 72, height = 28, color = "var(--chart-1)", label, area = true, className }: SparklineProps) {
  const gid = useId().replace(/:/g, "");
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const px = (i: number) => 2 + (i / (data.length - 1)) * (width - 4);
  const py = (v: number) => 3 + (1 - (v - min) / span) * (height - 6);
  const line = `M${data.map((v, i) => `${px(i)},${py(v)}`).join("L")}`;
  const last = data.length - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {label && <title>{label}</title>}
      {area && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={`${line}L${px(last)},${height}L${px(0)},${height}Z`} fill={`url(#${gid})`} />
        </>
      )}
      <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={px(last)} cy={py(data[last])} r={2.5} fill={color} />
    </svg>
  );
}

/* ---------------------------------------------------------------- */
/* Radar                                                             */
/* ---------------------------------------------------------------- */

export interface RadarChartProps {
  /** Axis names (5-8 work best), e.g. subjects. */
  axes: string[];
  series: ChartSeries[];
  label: string;
  max?: number;
  size?: number;
  formatValue?: (n: number) => string;
  showLegend?: boolean;
  className?: string;
}

export function RadarChart({ axes, series, label, max = 100, size = 260, formatValue = fmtDefault, showLegend = true, className }: RadarChartProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 56;
  const n = axes.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const point = (i: number, v: number) => [cx + Math.cos(angle(i)) * r * (v / max), cy + Math.sin(angle(i)) * r * (v / max)];
  const colorOf = (i: number) => series[i].color ?? CHART_COLORS[i % CHART_COLORS.length];
  const summary = `${label}. ${series.map((s) => `${s.name}: ${axes.map((a, i) => `${a} ${formatValue(s.values[i] ?? 0)}`).join(", ")}`).join("; ")}`;
  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={summary} className="max-w-full overflow-visible">
        <title>{summary}</title>
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <polygon key={t} points={axes.map((_, i) => point(i, max * t).join(",")).join(" ")} fill="none" stroke="var(--chart-grid)" />
        ))}
        {axes.map((a, i) => {
          const [ex, ey] = point(i, max);
          const [lx, ly] = point(i, max * 1.16);
          const cos = Math.cos(angle(i));
          return (
            <g key={a}>
              <line x1={cx} y1={cy} x2={ex} y2={ey} stroke="var(--chart-grid)" />
              <text x={lx} y={ly} dy="0.32em" textAnchor={Math.abs(cos) < 0.2 ? "middle" : cos > 0 ? "start" : "end"} className="fill-fg-secondary text-[11px]">
                {a}
              </text>
            </g>
          );
        })}
        {series.map((s, si) => (
          <g key={s.name}>
            <polygon
              points={axes.map((_, i) => point(i, Math.min(max, s.values[i] ?? 0)).join(",")).join(" ")}
              fill={colorOf(si)}
              fillOpacity={0.14}
              stroke={colorOf(si)}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {axes.map((a, i) => {
              const [px, py] = point(i, Math.min(max, s.values[i] ?? 0));
              return (
                <circle key={a} cx={px} cy={py} r={3} fill={colorOf(si)} stroke="var(--surface)" strokeWidth={1.5}>
                  <title>{`${s.name}, ${a}: ${formatValue(s.values[i] ?? 0)}`}</title>
                </circle>
              );
            })}
          </g>
        ))}
      </svg>
      {showLegend && series.length > 1 && <Legend items={series.map((s, i) => ({ label: s.name, color: colorOf(i) }))} />}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Calendar heatmap                                                  */
/* ---------------------------------------------------------------- */

export interface HeatmapDay {
  /** YYYY-MM-DD */
  date: string;
  /** Numeric intensity (used when getTone is not given). */
  value?: number;
  /** Status tone for the cell (e.g. attendance: success present, danger absent). */
  tone?: AnyTone;
  /** Tooltip text; defaults to date and value. */
  title?: string;
}

export interface CalendarHeatmapProps {
  days: HeatmapDay[];
  /** First and last date shown (YYYY-MM-DD). Defaults to the data range. */
  from?: string;
  to?: string;
  label: string;
  /** Max value for intensity scale; default = data max. */
  max?: number;
  cellSize?: number;
  /** Legend items under the grid. */
  legend?: LegendItem[];
  className?: string;
}

const DOW = ["Mon", "", "Wed", "", "Fri", "", ""];
const isoDay = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

/** Weeks as columns, Monday-first rows. Tone cells for status data, indigo intensity for counts. */
export function CalendarHeatmap({ days, from, to, label, max, cellSize = 14, legend, className }: CalendarHeatmapProps) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const start = new Date(`${from ?? sorted[0]?.date ?? isoDay(new Date())}T00:00:00Z`);
  const end = new Date(`${to ?? sorted[sorted.length - 1]?.date ?? isoDay(new Date())}T00:00:00Z`);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const vmax = max ?? Math.max(1, ...days.map((d) => d.value ?? 0));
  // Back up to Monday.
  const first = new Date(start);
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  const weeks: Date[][] = [];
  for (let d = new Date(first); d <= end; ) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(d));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  const gap = 3;
  const step = cellSize + gap;
  const left = 28;
  const top = 16;
  const w = left + weeks.length * step;
  const h = top + 7 * step;
  const summary = `${label}, ${isoDay(start)} to ${isoDay(end)}`;
  // When the grid is wider than its container (phones), start scrolled to the newest weeks.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [w]);
  const toneFill: Record<string, string> = {
    success: "var(--success)",
    warning: "var(--warning)",
    danger: "var(--danger)",
    info: "var(--info)",
    neutral: "var(--chart-6)",
    primary: "var(--chart-1)",
  };
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div ref={scrollRef} className="overflow-x-auto">
        <svg width={w} height={h} role="img" aria-label={summary}>
          <title>{summary}</title>
          {DOW.map((d, i) =>
            d ? (
              <text key={i} x={0} y={top + i * step + cellSize / 2} dy="0.32em" className="fill-fg-muted text-[10px]">
                {d}
              </text>
            ) : null,
          )}
          {weeks.map((week, wi) => {
            const firstOfMonth = week.find((d) => d.getUTCDate() === 1);
            return (
              <g key={wi}>
                {(wi === 0 || firstOfMonth) && (
                  <text x={left + wi * step} y={10} className="fill-fg-muted text-[10px]">
                    {(firstOfMonth ?? week[0]).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}
                  </text>
                )}
                {week.map((d, di) => {
                  if (d < start || d > end) return null;
                  const key = isoDay(d);
                  const item = byDate.get(key);
                  let fill = "var(--chart-track)";
                  let opacity = 1;
                  if (item?.tone) fill = toneFill[toTone(item.tone)];
                  else if (item?.value) {
                    fill = "var(--chart-1)";
                    opacity = 0.2 + 0.8 * Math.min(1, item.value / vmax);
                  }
                  return (
                    <rect key={key} x={left + wi * step} y={top + di * step} width={cellSize} height={cellSize} rx={3} fill={fill} fillOpacity={opacity}>
                      <title>{item?.title ?? `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}${item?.value !== undefined ? `: ${item.value}` : ""}`}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      {legend && <Legend items={legend} />}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Progress                                                          */
/* ---------------------------------------------------------------- */

const BAR_FILL: Record<string, string> = { ...TONE_DOT, primary: "bg-primary", neutral: "bg-fg-muted" };

export interface ProgressBarProps {
  value: number;
  max?: number;
  /** Visible label above the bar. */
  label?: ReactNode;
  /** Show "72%" on the right of the label row. */
  showValue?: boolean;
  /** Custom right-side text, e.g. "12/20 lessons". */
  valueText?: string;
  tone?: AnyTone;
  size?: "sm" | "md";
  className?: string;
}

export function ProgressBar({ value, max = 100, label, showValue, valueText, tone = "primary", size = "md", className }: ProgressBarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const text = valueText ?? `${Math.round(pct)}%`;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {(label || showValue || valueText) && (
        <div className="flex items-center justify-between gap-3 text-[13px]">
          {label && <span className="truncate text-fg-secondary">{label}</span>}
          {(showValue || valueText) && <span className="ms-auto font-medium tabular-nums text-fg">{text}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
        aria-label={typeof label === "string" ? label : undefined}
        className={cn("w-full overflow-hidden rounded-full bg-chart-track", size === "sm" ? "h-1.5" : "h-2")}
      >
        <div className={cn("h-full rounded-full transition-[width] duration-300 ease-out", BAR_FILL[toTone(tone)])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export interface ProgressRingProps {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  tone?: AnyTone;
  /** Accessible name. */
  label: string;
  /** Centre content; defaults to the percentage. */
  children?: ReactNode;
  className?: string;
}

export function ProgressRing({ value, max = 100, size = 56, stroke = 5, tone = "primary", label, children, className }: ProgressRingProps) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = STATUS_COLORS[toTone(tone)];
  return (
    <div
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--chart-track)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          className="transition-[stroke-dasharray] duration-500 ease-out"
        />
      </svg>
      <span className="absolute text-xs font-semibold tabular-nums text-fg">{children ?? `${Math.round(pct * 100)}%`}</span>
    </div>
  );
}
