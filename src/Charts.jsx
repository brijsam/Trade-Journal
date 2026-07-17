/**
 * Every Recharts-backed component in the app.
 *
 * Split out of App.jsx purely so Recharts can be code-split: App.jsx pulls this
 * module in with React.lazy, which keeps ~300kB of charting library out of the
 * initial bundle. Anything imported here lands in the chart chunk, so this file
 * deliberately depends only on ./lib/format — importing App.jsx back would be
 * circular and would drag the whole app into the chunk.
 *
 * The components themselves are unchanged from when they lived in App.jsx.
 *
 * Every Bar, Pie and Area here sets isAnimationActive={false}, and new ones must
 * too. Recharts' entrance animations do not run to completion when this module
 * mounts lazily, which leaves marks stuck at their zero-size starting frame:
 * bars render as nothing, pie sectors collapse to radius 0, and any label
 * positioned from them disappears with them. Recharts also gates <LabelList> on
 * the parent's animation having finished, so leaving animation on hides the
 * value labels even where the bars themselves survive.
 */
import { useMemo } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area, ReferenceLine, LabelList,
  ScatterChart, Scatter,
} from 'recharts';
import { round, fmtCurrency, fmtPercent, fmtProfitFactor, fmtSignedCurrency, fmtSignedPercent } from './lib/format';
const CHART_TOOLTIP_STYLE = { background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: "var(--text-primary)" };
/* Renders a value label on a bar. Bars are always drawn from an absolute value
   so nothing crosses the axis, so the label reads the row's true signed value
   instead — a loss shows "-$50" above a bar that points up. Rows with a zero or
   absent value get no label rather than a "$0" sitting on the baseline.

   Pair with `valueAccessor={barRow}`: the row is read from the label's own entry
   rather than by indexing the source array, because Recharts drops zero-height
   bars and the entry index then no longer lines up with the data index.

   NOTE: the Bar must also set isAnimationActive={false}. Recharts only exposes
   the label context while `!isAnimating`, and with animation left on the labels
   never appear. */
const barRow = (entry) => entry.payload;
function barLabel(format, { valueKey = "pnl", color, horizontal = false } = {}) {
  return (props) => {
    const row = props.value;
    const box = props.viewBox || {};
    if (!row) return null;
    const v = row[valueKey];
    if (!v) return null;
    const fill = color ? color(row) : v >= 0 ? "var(--profit)" : "var(--loss)";
    const x = horizontal ? (box.x ?? 0) + (box.width ?? 0) + 4 : (box.x ?? 0) + (box.width ?? 0) / 2;
    const y = horizontal ? (box.y ?? 0) + (box.height ?? 0) / 2 + 3 : (box.y ?? 0) - 4;
    return (
      <text x={x} y={y} textAnchor={horizontal ? "start" : "middle"} fontSize={9} fill={fill}>
        {format(v, row)}
      </text>
    );
  };
}

export function EquityCurveChart({ points }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={points} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <defs><linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--accent)" stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text-muted)" }} minTickGap={30} />
        <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickFormatter={(v) => `$${v.toLocaleString()}`} width={70} />
        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => fmtCurrency(v)} />
        <Area type="monotone" dataKey="balance" stroke="var(--accent)" strokeWidth={2} fill="url(#eqGrad)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
export function DailyPnLChart({ data, mode = "amount" }) {
  const valueKey = mode === "percent" ? "pnlPercent" : "pnl";
  const displayData = useMemo(() => data.map((d) => ({ ...d, _abs: Math.abs(d[valueKey] ?? 0) })), [data, valueKey]);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={displayData} margin={{ top: 22, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text-muted)" }} minTickGap={20} />
        <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickFormatter={(v) => mode === "percent" ? `${v}%` : `$${v}`} width={60} />
        <Tooltip content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          const p = payload[0]?.payload;
          const val = p?.[valueKey];
          return (
            <div style={{ ...CHART_TOOLTIP_STYLE, padding: "8px 10px", minWidth: 150 }}>
              <div style={{ fontWeight: 700, marginBottom: 4, borderBottom: "1px solid var(--border-soft)", paddingBottom: 4 }}>{label}</div>
              <div style={{ color: (val ?? 0) >= 0 ? "var(--profit)" : "var(--loss)" }}>{fmtSignedCurrency(p?.pnl)} / {fmtSignedPercent(p?.pnlPercent, 1)}</div>
              {p?.winRate != null && <div>Win Rate: {fmtPercent(p.winRate, 1)}</div>}
              {p?.trades != null && <div>Trades: {p.trades} ({p?.wins ?? 0}W / {p?.losses ?? 0}L)</div>}
              {p?.profitFactor != null && <div>PF: {fmtProfitFactor(p.profitFactor)}</div>}
            </div>
          );
        }} />
        <ReferenceLine y={0} stroke="var(--border)" />
        <Bar dataKey="_abs" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          <LabelList valueAccessor={barRow} content={barLabel((v, d) => `${fmtSignedCurrency(d.pnl)} / ${fmtSignedPercent(d.pnlPercent, 1)}`, { valueKey })} />
          {displayData.map((d, i) => <Cell key={i} fill={d[valueKey] >= 0 ? "var(--profit)" : "var(--loss)"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
export function MonthlyChart({ data, mode = "amount" }) {
  const valueKey = mode === "percent" ? "pnlPercent" : "pnl";
  const displayData = useMemo(() => data.map((d) => ({ ...d, _abs: Math.abs(d[valueKey] ?? 0) })), [data, valueKey]);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={displayData} margin={{ top: 22, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
        <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickFormatter={(v) => mode === "percent" ? `${v}%` : `$${v}`} width={60} />
        <Tooltip content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          const p = payload[0]?.payload;
          const val = p?.[valueKey];
          return (
            <div style={{ ...CHART_TOOLTIP_STYLE, padding: "8px 10px", minWidth: 150 }}>
              <div style={{ fontWeight: 700, marginBottom: 4, borderBottom: "1px solid var(--border-soft)", paddingBottom: 4 }}>{p?.month || label}</div>
              <div style={{ color: (val ?? 0) >= 0 ? "var(--profit)" : "var(--loss)" }}>{fmtSignedCurrency(p?.pnl)} / {fmtSignedPercent(p?.pnlPercent, 1)}</div>
              {p?.winRate != null && <div>Win Rate: {fmtPercent(p.winRate, 1)}</div>}
              {p?.trades != null && <div>Trades: {p.trades} ({p?.wins ?? 0}W / {p?.losses ?? 0}L)</div>}
              {p?.profitFactor != null && <div>PF: {fmtProfitFactor(p.profitFactor)}</div>}
            </div>
          );
        }} />
        <ReferenceLine y={0} stroke="var(--border)" />
        <Bar dataKey="_abs" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          <LabelList valueAccessor={barRow} content={barLabel((v, d) => `${fmtSignedCurrency(d.pnl)} / ${fmtSignedPercent(d.pnlPercent, 1)}`, { valueKey })} />
          {displayData.map((d, i) => <Cell key={i} fill={d[valueKey] >= 0 ? "var(--profit)" : "var(--loss)"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
export function WinLossPie({ wins, losses, breakeven }) {
  const data = [{ name: "Wins", value: wins, color: "var(--profit)" }, { name: "Losses", value: losses, color: "var(--loss)" }, ...(breakeven ? [{ name: "Breakeven", value: breakeven, color: "var(--text-muted)" }] : [])].filter((d) => d.value > 0);
  if (data.length === 0) return <div className="empty-state-sm">No closed trades yet.</div>;
  // Label sits in the middle of the donut band. Slices under 8% are skipped —
  // the arc is too short to hold the text without it spilling into a neighbour.
  const sliceLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value, percent }) => {
    if (percent < 0.08) return null;
    const RADIAN = Math.PI / 180;
    const r = innerRadius + (outerRadius - innerRadius) / 2;
    const x = cx + r * Math.cos(-midAngle * RADIAN);
    const y = cy + r * Math.sin(-midAngle * RADIAN);
    return (
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={700} fill="var(--text-primary)">
        {value} · {Math.round(percent * 100)}%
      </text>
    );
  };
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        {/* Animation off for the same reason as the bars: this module mounts
            lazily, and Recharts' entrance animation grows sectors from radius 0.
            When it doesn't run to completion the sectors — and the labels
            positioned from them — never appear at all. */}
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} label={sliceLabel} labelLine={false} isAnimationActive={false}>{data.map((d, i) => <Cell key={i} fill={d.color} stroke="var(--bg-800)" strokeWidth={2} />)}</Pie>
        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 11, color: "var(--text-secondary)" }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
function round1(v) { return v === null || v === undefined || !Number.isFinite(v) ? 0 : Math.round(v * 10) / 10; }
function clamp(v, lo, hi) { if (v === null || !Number.isFinite(v)) return 0; return Math.max(lo, Math.min(hi, v)); }
function fmtMetric(v, suffix) { return (v < 0 ? `-${Math.abs(v)}` : String(v)) + suffix; }
export function LongShortChart({ longStats, shortStats }) {
  const data = [
    { metric: "Win Rate %", suffix: "%", Long: round1(longStats.winRate), Short: round1(shortStats.winRate) },
    { metric: "Avg RR", suffix: "R", Long: round1(longStats.avgRR), Short: round1(shortStats.avgRR) },
    { metric: "Profit Factor", suffix: "", Long: round1(clamp(longStats.profitFactor, 0, 10)), Short: round1(clamp(shortStats.profitFactor, 0, 10)) },
  ].map((d) => ({ ...d, LongBar: Math.abs(d.Long), ShortBar: Math.abs(d.Short) }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 22, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" vertical={false} />
        <XAxis dataKey="metric" tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
        <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} width={40} />
        <Tooltip content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          const d = payload[0]?.payload;
          return (
            <div style={{ ...CHART_TOOLTIP_STYLE, padding: "8px 10px", minWidth: 130 }}>
              <div style={{ fontWeight: 700, marginBottom: 4, borderBottom: "1px solid var(--border-soft)", paddingBottom: 4 }}>{label}</div>
              <div style={{ color: d.Long < 0 ? "var(--loss)" : "var(--profit)" }}>Long: {fmtMetric(d.Long, d.suffix)}</div>
              <div style={{ color: d.Short < 0 ? "var(--loss)" : "var(--accent-2)" }}>Short: {fmtMetric(d.Short, d.suffix)}</div>
            </div>
          );
        }} />
        <Legend wrapperStyle={{ fontSize: 11, color: "var(--text-secondary)" }} />
        <Bar name="Long" dataKey="LongBar" fill="var(--profit)" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          <LabelList valueAccessor={barRow} content={barLabel((v, d) => fmtMetric(v, d.suffix), { valueKey: "Long", color: (d) => (d.Long < 0 ? "var(--loss)" : "var(--profit)") })} />
        </Bar>
        <Bar name="Short" dataKey="ShortBar" fill="var(--accent-2)" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          <LabelList valueAccessor={barRow} content={barLabel((v, d) => fmtMetric(v, d.suffix), { valueKey: "Short", color: (d) => (d.Short < 0 ? "var(--loss)" : "var(--accent-2)") })} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
export function RRDistributionChart({ trades }) {
  const buckets = ["<-1R", "-1..0R", "0..1R", "1..2R", "2..3R", "3..5R", ">5R"];
  const counts = new Array(buckets.length).fill(0);
  trades.forEach((t) => {
    if (t.actualRR === null || !Number.isFinite(t.actualRR)) return;
    const r = t.actualRR;
    let idx;
    if (r < -1) idx = 0; else if (r < 0) idx = 1; else if (r < 1) idx = 2; else if (r < 2) idx = 3; else if (r < 3) idx = 4; else if (r < 5) idx = 5; else idx = 6;
    counts[idx] += 1;
  });
  const data = buckets.map((b, i) => ({ bucket: b, count: counts[i], isLoss: i <= 1 }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 22, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" vertical={false} />
        <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
        <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} width={30} allowDecimals={false} />
        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
        <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          <LabelList valueAccessor={barRow} content={barLabel((v) => String(v), { valueKey: "count", color: (d) => (d.isLoss ? "var(--loss)" : "var(--accent)") })} />
          {data.map((d, i) => <Cell key={i} fill={d.isLoss ? "var(--loss)" : "var(--accent)"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
export function HourOfDayChart({ trades }) {
  const buckets = new Array(24).fill(0).map(() => ({ pnl: 0, count: 0, wins: 0 }));
  trades.forEach((t) => {
    if (!t.entryDateTime) return;
    const hour = new Date(t.entryDateTime).getHours();
    if (Number.isNaN(hour)) return;
    buckets[hour].pnl += t.pnlAmount; buckets[hour].count += 1;
    if (t.result === "win") buckets[hour].wins += 1;
  });
  const data = buckets.map((b, h) => { const pnl = round(b.pnl, 2); return { hour: `${String(h).padStart(2, "0")}:00`, pnl, _abs: Math.abs(pnl), count: b.count, winRate: b.count ? (b.wins / b.count) * 100 : 0 }; });
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 22, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" vertical={false} />
        <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "var(--text-muted)" }} interval={2} />
        <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} width={50} tickFormatter={(v) => fmtCurrency(v)} />
        <Tooltip content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          const d = payload[0]?.payload;
          return (
            <div style={{ ...CHART_TOOLTIP_STYLE, padding: "8px 10px", minWidth: 140 }}>
              <div style={{ fontWeight: 700, marginBottom: 4, borderBottom: "1px solid var(--border-soft)", paddingBottom: 4 }}>{label}</div>
              <div style={{ color: d.pnl >= 0 ? "var(--profit)" : "var(--loss)" }}>{fmtSignedCurrency(d.pnl)}</div>
              <div>Trades: {d.count} · Win Rate: {fmtPercent(d.winRate, 0)}</div>
            </div>
          );
        }} />
        <Bar dataKey="_abs" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {/* 24 slots, so the label is amount-only — a dual amount/% label collides at this bar width. */}
          <LabelList valueAccessor={barRow} content={barLabel((v) => fmtSignedCurrency(v))} />
          {data.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? "var(--profit)" : "var(--loss)"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
export function DayOfWeekChart({ trades }) {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const buckets = names.map(() => ({ pnl: 0, count: 0, wins: 0 }));
  trades.forEach((t) => {
    if (!t.exitDateTime) return;
    const dow = new Date(t.exitDateTime).getDay();
    if (Number.isNaN(dow)) return;
    buckets[dow].pnl += t.pnlAmount; buckets[dow].count += 1;
    if (t.result === "win") buckets[dow].wins += 1;
  });
  const data = names.map((day, i) => { const pnl = round(buckets[i].pnl, 2); return { day, pnl, _abs: Math.abs(pnl), count: buckets[i].count, winRate: buckets[i].count ? (buckets[i].wins / buckets[i].count) * 100 : 0 }; });
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 22, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" vertical={false} />
        <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
        <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} width={50} tickFormatter={(v) => fmtCurrency(v)} />
        <Tooltip content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          const d = payload[0]?.payload;
          return (
            <div style={{ ...CHART_TOOLTIP_STYLE, padding: "8px 10px", minWidth: 140 }}>
              <div style={{ fontWeight: 700, marginBottom: 4, borderBottom: "1px solid var(--border-soft)", paddingBottom: 4 }}>{label}</div>
              <div style={{ color: d.pnl >= 0 ? "var(--profit)" : "var(--loss)" }}>{fmtSignedCurrency(d.pnl)}</div>
              <div>Trades: {d.count} · Win Rate: {fmtPercent(d.winRate, 0)}</div>
            </div>
          );
        }} />
        <Bar dataKey="_abs" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          <LabelList valueAccessor={barRow} content={barLabel((v) => fmtSignedCurrency(v))} />
          {data.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? "var(--profit)" : "var(--loss)"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
export function DurationHistogramChart({ trades }) {
  const buckets = ["<15m", "15-60m", "1-4h", "4-24h", "1-3d", ">3d"];
  const wins = new Array(buckets.length).fill(0);
  const losses = new Array(buckets.length).fill(0);
  trades.forEach((t) => {
    if (!t.entryDateTime || !t.exitDateTime || !t.result || t.result === "breakeven") return;
    const mins = (new Date(t.exitDateTime).getTime() - new Date(t.entryDateTime).getTime()) / 60000;
    if (!Number.isFinite(mins) || mins < 0) return;
    let idx;
    if (mins < 15) idx = 0; else if (mins < 60) idx = 1; else if (mins < 240) idx = 2; else if (mins < 1440) idx = 3; else if (mins < 4320) idx = 4; else idx = 5;
    if (t.result === "win") wins[idx] += 1; else losses[idx] += 1;
  });
  const data = buckets.map((b, i) => ({ bucket: b, Wins: wins[i], Losses: losses[i] }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" vertical={false} />
        <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
        <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} width={30} allowDecimals={false} />
        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 11, color: "var(--text-secondary)" }} />
        <Bar dataKey="Wins" fill="var(--profit)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="Losses" fill="var(--loss)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
export function AssetPerformanceChart({ trades, mode = "amount" }) {
  const valueKey = mode === "percent" ? "pnlPercent" : "pnl";
  const data = useMemo(() => {
    const map = {};
    trades.forEach((t) => {
      if (t.status !== "Closed" || t.pnlAmount === null) return;
      const key = t.symbol || "Unspecified";
      if (!map[key]) map[key] = { pnl: 0, pctSum: 0, pctCount: 0, trades: 0, wins: 0, losses: 0 };
      map[key].pnl += t.pnlAmount; map[key].trades += 1;
      if (t.result === "win") map[key].wins += 1;
      if (t.result === "loss") map[key].losses += 1;
      if (Number.isFinite(t.pnlPercent)) { map[key].pctSum += t.pnlPercent; map[key].pctCount += 1; }
    });
    return Object.entries(map).map(([symbol, row]) => ({
      symbol, pnl: row.pnl,
      pnlPercent: row.pctCount ? row.pctSum / row.pctCount : 0,
      trades: row.trades, wins: row.wins, losses: row.losses,
      winRate: row.trades ? (row.wins / row.trades) * 100 : 0,
      _abs: Math.abs(mode === "percent" ? (row.pctCount ? row.pctSum / row.pctCount : 0) : row.pnl),
    })).sort((a, b) => b.pnl - a.pnl).slice(0, 10);
  }, [trades, mode]);
  if (data.length === 0) return <div className="empty-state-sm">No closed trades yet.</div>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 34)}>
      <BarChart data={data} layout="vertical" margin={{ top: 6, right: 130, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickFormatter={(v) => mode === "percent" ? `${v}%` : `$${v}`} />
        <YAxis type="category" dataKey="symbol" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} width={80} />
        <Tooltip content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const p = payload[0]?.payload;
          const val = p?.[valueKey];
          return (
            <div style={{ ...CHART_TOOLTIP_STYLE, padding: "8px 10px", minWidth: 150 }}>
              <div style={{ fontWeight: 700, marginBottom: 4, borderBottom: "1px solid var(--border-soft)", paddingBottom: 4 }}>{p?.symbol}</div>
              <div style={{ color: (val ?? 0) >= 0 ? "var(--profit)" : "var(--loss)" }}>{fmtSignedCurrency(p?.pnl)} / {fmtSignedPercent(p?.pnlPercent, 1)}</div>
              <div>Win Rate: {fmtPercent(p?.winRate, 1)}</div>
              <div>Trades: {p?.trades} ({p?.wins ?? 0}W / {p?.losses ?? 0}L)</div>
            </div>
          );
        }} />
        <Bar dataKey="_abs" radius={[0, 3, 3, 0]} isAnimationActive={false}>
          <LabelList valueAccessor={barRow} content={barLabel((v, d) => `${fmtSignedCurrency(d.pnl)} / ${fmtSignedPercent(d.pnlPercent, 1)}`, { valueKey, horizontal: true })} />
          {data.map((d, i) => <Cell key={i} fill={d[valueKey] >= 0 ? "var(--profit)" : "var(--loss)"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
export function StrategyPerformanceChart({ trades, mode = "amount" }) {
  const valueKey = mode === "percent" ? "pnlPercent" : "pnl";
  const data = useMemo(() => {
    const map = {};
    trades.forEach((t) => {
      if (t.status !== "Closed" || t.pnlAmount === null) return;
      const key = t.strategy?.trim() || "Unspecified";
      if (!map[key]) map[key] = { pnl: 0, pctSum: 0, pctCount: 0, trades: 0, wins: 0, losses: 0 };
      map[key].pnl += t.pnlAmount; map[key].trades += 1;
      if (t.result === "win") map[key].wins += 1;
      if (t.result === "loss") map[key].losses += 1;
      if (Number.isFinite(t.pnlPercent)) { map[key].pctSum += t.pnlPercent; map[key].pctCount += 1; }
    });
    return Object.entries(map).map(([strategy, row]) => ({
      strategy, pnl: row.pnl,
      pnlPercent: row.pctCount ? row.pctSum / row.pctCount : 0,
      trades: row.trades, wins: row.wins, losses: row.losses,
      winRate: row.trades ? (row.wins / row.trades) * 100 : 0,
      _abs: Math.abs(mode === "percent" ? (row.pctCount ? row.pctSum / row.pctCount : 0) : row.pnl),
    })).sort((a, b) => b.pnl - a.pnl).slice(0, 10);
  }, [trades, mode]);
  if (data.length === 0) return <div className="empty-state-sm">No closed trades yet.</div>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ top: 6, right: 130, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickFormatter={(v) => mode === "percent" ? `${v}%` : `$${v}`} />
        <YAxis type="category" dataKey="strategy" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} width={130} />
        <Tooltip content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const p = payload[0]?.payload;
          const val = p?.[valueKey];
          return (
            <div style={{ ...CHART_TOOLTIP_STYLE, padding: "8px 10px", minWidth: 150 }}>
              <div style={{ fontWeight: 700, marginBottom: 4, borderBottom: "1px solid var(--border-soft)", paddingBottom: 4 }}>{p?.strategy}</div>
              <div style={{ color: (val ?? 0) >= 0 ? "var(--profit)" : "var(--loss)" }}>{fmtSignedCurrency(p?.pnl)} / {fmtSignedPercent(p?.pnlPercent, 1)}</div>
              <div>Win Rate: {fmtPercent(p?.winRate, 1)}</div>
              <div>Trades: {p?.trades} ({p?.wins ?? 0}W / {p?.losses ?? 0}L)</div>
            </div>
          );
        }} />
        <Bar dataKey="_abs" radius={[0, 3, 3, 0]} isAnimationActive={false}>
          <LabelList valueAccessor={barRow} content={barLabel((v, d) => `${fmtSignedCurrency(d.pnl)} / ${fmtSignedPercent(d.pnlPercent, 1)}`, { valueKey, horizontal: true })} />
          {data.map((d, i) => <Cell key={i} fill={d[valueKey] >= 0 ? "var(--profit)" : "var(--loss)"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
export function PerformanceBarChart({ data, labelKey, mode = "amount" }) {
  const valueKey = mode === "percent" ? "pnlPercent" : "pnl";
  const displayData = useMemo(() => data.slice(-18).map((d) => ({ ...d, _abs: Math.abs(d[valueKey] ?? 0) })), [data, valueKey]);
  if (displayData.length === 0) return <div className="empty-state-sm">No closed trades yet.</div>;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={displayData} margin={{ top: 22, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" vertical={false} />
        <XAxis dataKey={labelKey} tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
        <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} width={54} tickFormatter={(v) => mode === "percent" ? `${v}%` : `$${v}`} />
        <Tooltip content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          const p = payload[0]?.payload;
          const val = p?.[valueKey];
          return (
            <div style={{ ...CHART_TOOLTIP_STYLE, padding: "8px 10px", minWidth: 150 }}>
              <div style={{ fontWeight: 700, marginBottom: 4, borderBottom: "1px solid var(--border-soft)", paddingBottom: 4 }}>{p?.[labelKey] || label}</div>
              <div style={{ color: (val ?? 0) >= 0 ? "var(--profit)" : "var(--loss)" }}>{fmtSignedCurrency(p?.pnl)} / {fmtSignedPercent(p?.pnlPercent, 1)}</div>
              {p?.winRate != null && <div>Win Rate: {fmtPercent(p.winRate, 1)}</div>}
              {p?.trades != null && <div>Trades: {p.trades} ({p?.wins ?? 0}W / {p?.losses ?? 0}L)</div>}
              {p?.profitFactor != null && <div>PF: {fmtProfitFactor(p.profitFactor)}</div>}
            </div>
          );
        }} />
        <Legend wrapperStyle={{ fontSize: 11, color: "var(--text-secondary)" }} />
        <Bar dataKey="_abs" name={mode === "percent" ? "Avg P&L %" : "P&L"} radius={[3, 3, 0, 0]} isAnimationActive={false}>
          <LabelList valueAccessor={barRow} content={barLabel((v, d) => `${fmtSignedCurrency(d.pnl)} / ${fmtSignedPercent(d.pnlPercent, 1)}`, { valueKey })} />
          {displayData.map((d, i) => <Cell key={i} fill={d[valueKey] >= 0 ? "var(--profit)" : "var(--loss)"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}


/* Trade efficiency: how much of each trade's best unrealized move (MFE) was
   actually banked. Each point is one closed trade — x is the max favorable
   excursion, y is the realized P&L. The dashed diagonal is a perfect capture
   (y = x): points sitting on it took the whole favorable move, points well
   below it gave profit back before exiting. MAE rides along in the tooltip. */
export function MaeMfeChart({ trades }) {
  const data = useMemo(() => trades
    .filter((t) => t.result && (t._mfe !== null || t._mae !== null))
    .map((t) => {
      const mfe = t._mfe !== null ? Math.abs(t._mfe) : 0;
      const pnl = t.pnlAmount ?? 0;
      return {
        id: t.id, symbol: t.symbol || "—",
        mfe, mae: t._mae !== null ? Math.abs(t._mae) : 0, pnl,
        capture: mfe > 0 ? (pnl / mfe) * 100 : null,
        win: t.result === "win",
      };
    }), [trades]);
  if (!data.length) return <div className="empty-state-sm">No trades with MAE / MFE recorded yet. Add them on the trade form to see capture efficiency.</div>;
  const maxAxis = Math.max(1, ...data.map((d) => Math.max(d.mfe, d.pnl > 0 ? d.pnl : 0)));
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ScatterChart margin={{ top: 10, right: 20, left: 6, bottom: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
        <XAxis type="number" dataKey="mfe" name="MFE" tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickFormatter={(v) => `$${v}`}
          label={{ value: "Max Favorable Excursion ($)", position: "insideBottom", offset: -8, fontSize: 10, fill: "var(--text-muted)" }} />
        <YAxis type="number" dataKey="pnl" name="P&L" tick={{ fontSize: 10, fill: "var(--text-muted)" }} width={60} tickFormatter={(v) => `$${v}`} />
        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: maxAxis, y: maxAxis }]} stroke="var(--accent)" strokeDasharray="4 4" ifOverflow="hidden" />
        <ReferenceLine y={0} stroke="var(--border)" />
        <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const p = payload[0]?.payload;
          if (!p) return null;
          return (
            <div style={{ ...CHART_TOOLTIP_STYLE, padding: "8px 10px", minWidth: 160 }}>
              <div style={{ fontWeight: 700, marginBottom: 4, borderBottom: "1px solid var(--border-soft)", paddingBottom: 4 }}>{p.symbol} · {p.id}</div>
              <div style={{ color: p.pnl >= 0 ? "var(--profit)" : "var(--loss)" }}>P&L: {fmtSignedCurrency(p.pnl)}</div>
              <div>MFE: {fmtCurrency(p.mfe)}</div>
              <div>MAE: {fmtCurrency(p.mae)}</div>
              {p.capture !== null && <div>Captured: {fmtPercent(p.capture, 0)} of MFE</div>}
            </div>
          );
        }} />
        <Scatter data={data} isAnimationActive={false}>
          {data.map((d, i) => <Cell key={i} fill={d.win ? "var(--profit)" : "var(--loss)"} fillOpacity={0.75} />)}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
