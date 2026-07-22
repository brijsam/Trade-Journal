/**
 * Number and value formatting shared by the app shell and the chart bundle.
 *
 * These live outside App.jsx so the lazily-loaded chart module can use them
 * without importing App.jsx back — that would be a circular import, and it would
 * also drag the whole app into the chart chunk and defeat the code splitting.
 *
 * Everything here is pure and display-only. No trade maths lives in this file.
 */

// v is `unknown` on the two parsing entry points (num, and nothing else here)
// because callers hand these real user input, storage strings and numbers
// alike; every fmt* below only ever receives what num()/computeTrade already
// narrowed to number|null, so they stay strictly typed.
export const num = (v: unknown, fallback: number | null = null): number | null => {
  const n = parseFloat(v as string);
  return Number.isFinite(n) ? n : fallback;
};

export function round(v: number | null | undefined, d = 6): number | null | undefined {
  if (v === null || v === undefined || !Number.isFinite(v)) return v;
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

export function fmtCurrency(v: number | null | undefined, opts: Intl.NumberFormatOptions = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  return `${sign}$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2, ...opts })}`;
}

export function fmtPercent(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

export function fmtProfitFactor(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return Number.isFinite(v) ? fmtNum(v) : "∞";
}

export function fmtSignedCurrency(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v > 0 ? "+" : ""}${fmtCurrency(v)}`;
}

export function fmtSignedPercent(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v > 0 ? "+" : ""}${fmtPercent(v, digits)}`;
}
