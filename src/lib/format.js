/**
 * Number and value formatting shared by the app shell and the chart bundle.
 *
 * These live outside App.jsx so the lazily-loaded chart module can use them
 * without importing App.jsx back — that would be a circular import, and it would
 * also drag the whole app into the chart chunk and defeat the code splitting.
 *
 * Everything here is pure and display-only. No trade maths lives in this file.
 */

export const num = (v, fallback = null) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

export function round(v, d = 6) {
  if (v === null || v === undefined || !Number.isFinite(v)) return v;
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

export function fmtCurrency(v, opts = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  return `${sign}$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2, ...opts })}`;
}

export function fmtPercent(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

export function fmtNum(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

export function fmtProfitFactor(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return Number.isFinite(v) ? fmtNum(v) : "∞";
}

export function fmtSignedCurrency(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v > 0 ? "+" : ""}${fmtCurrency(v)}`;
}

export function fmtSignedPercent(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v > 0 ? "+" : ""}${fmtPercent(v, digits)}`;
}
