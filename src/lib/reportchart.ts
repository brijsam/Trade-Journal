/* ============================================================================
   REPORT CHARTS — pure SVG/HTML builders for the exported reports
   ----------------------------------------------------------------------------
   The in-app charts are Recharts (src/Charts.tsx), which needs a live React
   tree — an exported .pdf/.doc/.html file has none. These build the same
   pictures as plain strings instead: no React, no DOM, no measurement, so they
   are testable in Node and safe to call from an export handler.

   Two renderings on purpose:
     - SVG (svgLineChart / svgBarChart / svgDonut) for the PDF and the
       interactive HTML report, both rendered by a real browser engine.
     - htmlBarRows, a table of coloured cells, for the Word (.doc) report.
       Word's HTML importer does not render inline SVG — it drops it silently —
       so the Word path gets bars built from table cells it can actually draw.

   Colours are fixed rather than themed: a report is read on white paper or in
   Word, not inside the app, so it can't reach the app's CSS tokens. Green/red
   still mean P&L only, matching the app's rule (CLAUDE.md § Styling).
============================================================================ */
import { escapeHtml } from "./trade";

export const REPORT_COLORS = {
  profit: "#0F9D52",
  loss: "#D63A50",
  accent: "#2F6FED",
  accentSoft: "rgba(47,111,237,0.14)",
  grid: "#E3E7EE",
  axis: "#9AA3B2",
  text: "#4A5262",
  ink: "#161A22",
};

export interface ChartPoint { label: string; value: number }
export interface ChartSlice { label: string; value: number; color: string }

/** Trim float noise so a path attribute stays readable and the file stays small. */
function r(n: number): number { return Math.round(n * 100) / 100; }

/* A rounded step for the value axis: 1/2/5 × a power of ten covering the span.
   Without it the gridline labels come out as 1327.4183 and the axis reads as
   noise. */
export function niceStep(span: number, targetLines = 4): number {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const raw = span / Math.max(1, targetLines);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/* Gridline values covering [min, max], snapped outward to whole steps so the
   first and last line sit on round numbers. Always at least two lines, so a
   flat series still draws an axis instead of nothing. */
export function axisTicks(min: number, max: number, targetLines = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) { const pad = Math.abs(min) || 1; min -= pad / 2; max += pad / 2; }
  const step = niceStep(max - min, targetLines);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 1000 && out.length < 40; v += step) out.push(r(v));
  return out;
}

/** Compact axis money: 12500 -> "12.5k", -2_400_000 -> "-2.4M". */
export function axisLabel(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${r(v / 1e6)}M`;
  if (abs >= 1e3) return `${r(v / 1e3)}k`;
  return String(r(v));
}

interface ChartOpts { width?: number; height?: number; color?: string; empty?: string }

/* Shared frame: gridlines, their labels, and a baseline at zero when the series
   crosses it. Returns the markup plus the projection the caller plots with. */
function frame(values: number[], width: number, height: number, includeZero: boolean) {
  const padL = 54, padR = 12, padT = 12, padB = 30;
  const lo = Math.min(...values, includeZero ? 0 : Infinity);
  const hi = Math.max(...values, includeZero ? 0 : -Infinity);
  const ticks = axisTicks(lo, hi);
  const min = ticks[0], max = ticks[ticks.length - 1];
  const span = max - min || 1;
  const plotW = width - padL - padR, plotH = height - padT - padB;
  const y = (v: number) => r(padT + plotH - ((v - min) / span) * plotH);
  const x = (i: number, n: number) => r(padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW));
  const grid = ticks.map((t) => `<line x1="${padL}" y1="${y(t)}" x2="${width - padR}" y2="${y(t)}" stroke="${REPORT_COLORS.grid}" stroke-width="1"/>`
    + `<text x="${padL - 7}" y="${y(t) + 3.5}" text-anchor="end" font-size="9" fill="${REPORT_COLORS.axis}">${axisLabel(t)}</text>`).join("");
  return { padL, padR, padT, padB, plotW, plotH, min, max, y, x, grid };
}

/* Equity curve: a filled area under a single line. Points arrive in time order;
   only the first and last label are drawn, because a per-trade x axis on a
   printed page is unreadable at any real journal size. */
export function svgLineChart(points: ChartPoint[], opts: ChartOpts = {}): string {
  const { width = 720, height = 240, color = REPORT_COLORS.accent, empty = "No closed trades yet." } = opts;
  if (points.length < 2) return `<p class="chart-empty">${escapeHtml(empty)}</p>`;
  const values = points.map((p) => p.value);
  const f = frame(values, width, height, false);
  const pts = points.map((p, i) => `${f.x(i, points.length)},${f.y(p.value)}`);
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${f.x(points.length - 1, points.length)},${f.y(f.min)} L${f.x(0, points.length)},${f.y(f.min)} Z`;
  const baseY = height - f.padB + 14;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Equity curve" xmlns="http://www.w3.org/2000/svg">`
    + f.grid
    + `<path d="${area}" fill="${color}" fill-opacity="0.12"/>`
    + `<path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`
    + `<text x="${f.padL}" y="${baseY}" font-size="9" fill="${REPORT_COLORS.axis}">${escapeHtml(points[0].label)}</text>`
    + `<text x="${width - f.padR}" y="${baseY}" text-anchor="end" font-size="9" fill="${REPORT_COLORS.axis}">${escapeHtml(points[points.length - 1].label)}</text>`
    + `</svg>`;
}

/* Signed bars off a zero baseline — monthly P&L, per-strategy P&L. Green above,
   red below; the caller does not pick colours, because these are P&L. */
export function svgBarChart(rows: ChartPoint[], opts: ChartOpts = {}): string {
  const { width = 720, height = 240, empty = "Nothing to chart yet." } = opts;
  if (!rows.length) return `<p class="chart-empty">${escapeHtml(empty)}</p>`;
  const f = frame(rows.map((r2) => r2.value), width, height, true);
  const zeroY = f.y(0);
  const slot = f.plotW / rows.length;
  const barW = Math.max(3, Math.min(46, slot * 0.62));
  const bars = rows.map((row, i) => {
    const cx = f.padL + slot * (i + 0.5);
    const vy = f.y(row.value);
    const top = Math.min(vy, zeroY), h = Math.max(1, Math.abs(vy - zeroY));
    const fill = row.value < 0 ? REPORT_COLORS.loss : REPORT_COLORS.profit;
    // Labels are rotated only when the slots get tight — a printed report with
    // 12 months across it reads better flat.
    const rotate = slot < 52;
    const lx = r(cx), ly = height - f.padB + 13;
    const label = `<text x="${lx}" y="${ly}" font-size="9" fill="${REPORT_COLORS.axis}" text-anchor="${rotate ? "end" : "middle"}"${rotate ? ` transform="rotate(-40 ${lx} ${ly})"` : ""}>${escapeHtml(row.label)}</text>`;
    return `<rect x="${r(cx - barW / 2)}" y="${r(top)}" width="${r(barW)}" height="${r(h)}" fill="${fill}" rx="2"/>${label}`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Profit and loss by period" xmlns="http://www.w3.org/2000/svg">`
    + f.grid
    + `<line x1="${f.padL}" y1="${zeroY}" x2="${width - f.padR}" y2="${zeroY}" stroke="${REPORT_COLORS.axis}" stroke-width="1"/>`
    + bars
    + `</svg>`;
}

/* Win/loss/breakeven split. Drawn as stroked arcs on one circle rather than
   filled wedges: one path per slice, no wedge seams, and a hole to put the
   total in. Slices with no value are skipped, and a single 100% slice is drawn
   as a full circle — an arc of exactly 360° collapses to nothing. */
export function svgDonut(slices: ChartSlice[], opts: { size?: number; empty?: string; centerLabel?: string; centerSub?: string } = {}): string {
  const { size = 220, empty = "No closed trades yet.", centerLabel = "", centerSub = "" } = opts;
  const live = slices.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const total = live.reduce((s, x) => s + x.value, 0);
  if (!total) return `<p class="chart-empty">${escapeHtml(empty)}</p>`;
  const cx = size / 2, cy = size / 2, thickness = size * 0.16, rad = size / 2 - thickness / 2 - 2;
  const circumference = 2 * Math.PI * rad;
  let offset = 0;
  const arcs = live.map((s) => {
    const len = (s.value / total) * circumference;
    const seg = `<circle cx="${cx}" cy="${cy}" r="${r(rad)}" fill="none" stroke="${s.color}" stroke-width="${r(thickness)}"`
      + ` stroke-dasharray="${r(len)} ${r(circumference - len)}" stroke-dashoffset="${r(-offset)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += len;
    return seg;
  }).join("");
  const center = centerLabel
    ? `<text x="${cx}" y="${cy + 2}" text-anchor="middle" font-size="20" font-weight="700" fill="${REPORT_COLORS.ink}">${escapeHtml(centerLabel)}</text>`
      + (centerSub ? `<text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="10" fill="${REPORT_COLORS.axis}">${escapeHtml(centerSub)}</text>` : "")
    : "";
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Win and loss split" xmlns="http://www.w3.org/2000/svg">${arcs}${center}</svg>`;
}

/* A legend for the donut, since arcs alone say nothing on paper. */
export function chartLegend(slices: ChartSlice[]): string {
  const live = slices.filter((s) => s.value > 0);
  if (!live.length) return "";
  return `<p class="chart-legend">${live.map((s) => `<span class="legend-item"><span class="legend-dot" style="background:${s.color}"></span>${escapeHtml(s.label)} — ${s.value}</span>`).join("")}</p>`;
}

/* Word-safe bars: one table row per entry, the bar a coloured cell whose width
   is a percentage of the widest absolute value in the set. Word renders table
   cell widths and background colours reliably; it renders inline SVG not at
   all, which is why this exists next to svgBarChart rather than instead of it.
   `format` turns the raw value into the text shown at the end of the row. */
export function htmlBarRows(rows: ChartPoint[], opts: { format?: (v: number) => string; empty?: string } = {}): string {
  const { format = (v: number) => String(r(v)), empty = "Nothing to chart yet." } = opts;
  if (!rows.length) return `<p class="chart-empty">${escapeHtml(empty)}</p>`;
  const peak = Math.max(...rows.map((row) => Math.abs(row.value)), 0) || 1;
  const body = rows.map((row) => {
    const pct = Math.max(1, Math.round((Math.abs(row.value) / peak) * 100));
    const color = row.value < 0 ? REPORT_COLORS.loss : REPORT_COLORS.profit;
    return `<tr><td class="bar-label">${escapeHtml(row.label)}</td>`
      + `<td class="bar-track"><table class="bar-inner" cellpadding="0" cellspacing="0"><tr>`
      + `<td width="${pct}%" bgcolor="${color}" style="background:${color};height:11px;line-height:11px;font-size:1px">&nbsp;</td>`
      + `<td width="${100 - pct}%">&nbsp;</td></tr></table></td>`
      + `<td class="bar-value" style="color:${color}">${escapeHtml(format(row.value))}</td></tr>`;
  }).join("");
  return `<table class="bar-table">${body}</table>`;
}
