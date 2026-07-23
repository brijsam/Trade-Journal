/* ============================================================================
   REPORT DOCUMENTS — the exported reports' markup
   ----------------------------------------------------------------------------
   Pure builders for what the Reports tab writes to disk: the chart section
   shared by every format, and the whole interactive .html report. No React, no
   DOM, no storage — a report is a string, which is what makes it testable in
   Node and what keeps this out of App.tsx's 5k lines.

   App.tsx owns the *saving* (native Save As on desktop, a blob download on
   web); this file owns what goes in the file. The chart primitives themselves
   are in ./reportchart.

   Escaping is the standing rule here: every value that came from a trader —
   symbol, strategy, note, tag, screenshot stage, the journal's own name — goes
   through escapeHtml, including the ones written into data-* attributes.
============================================================================ */
import { escapeHtml, groupPerformance, strategyPerformance, monthKey, monthLabel, fmtDate, type ComputedTrade, type EquityPoint, type SummaryStats } from "./trade";
import { fmtCurrency, fmtNum, fmtPercent, fmtProfitFactor, fmtSignedCurrency } from "./format";
import { svgLineChart, svgBarChart, svgDonut, chartLegend, htmlBarRows, REPORT_COLORS, type ChartPoint, type ChartSlice } from "./reportchart";

export interface ReportShot { stage: string; dataUrl: string }
export interface ReportChartData { curve: ChartPoint[]; monthly: ChartPoint[]; strategies: ChartPoint[]; split: ChartSlice[] }

/* Styling for the chart markup reportchart builds. Literal colours on purpose:
   an exported file is read outside the app, where none of its CSS tokens
   exist. The bar-table overrides matter — the report's own
   `td,th { border: 1px solid #ccc }` would otherwise draw a grid through every
   bar. */
export const REPORT_CHART_CSS = `
.chart-block { margin: 12px 0 18px; page-break-inside: avoid; }
.chart-row { display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-start; }
.chart-half { flex: 1 1 300px; min-width: 260px; }
.chart-empty { font-size: 11px; color: #9AA3B2; font-style: italic; margin: 6px 0; }
.chart-legend { font-size: 10.5px; color: #4A5262; margin: 6px 0 0; }
.legend-item { margin-right: 14px; white-space: nowrap; }
.legend-dot { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
.bar-table { width: 100%; border-collapse: collapse; margin: 4px 0; }
.bar-table td { border: none; padding: 3px 6px; font-size: 10.5px; vertical-align: middle; }
.bar-label { width: 26%; color: #4A5262; }
.bar-track { width: 56%; }
.bar-inner { width: 100%; border-collapse: collapse; table-layout: fixed; }
.bar-inner td { border: none; padding: 0; }
.bar-value { width: 18%; text-align: right; font-weight: 700; white-space: nowrap; }
`;

/* The four series every report charts, off the same numbers its tables use. */
export function reportChartData(trades: ComputedTrade[], points: EquityPoint[], overall: SummaryStats): ReportChartData {
  const closed = trades.filter((t) => t.status === "Closed");
  const monthly = groupPerformance(closed, (d) => ({ key: monthKey(d) || "", label: monthLabel(d), sortKey: monthKey(d) || undefined }), "month");
  const names = [...new Set(closed.map((t) => t.strategy).filter(Boolean))] as string[];
  return {
    curve: points.map((p) => ({ label: p.date, value: p.balance })),
    monthly: monthly.map((m) => ({ label: String(m.month), value: m.pnl })),
    strategies: strategyPerformance(closed, names)
      .filter((r) => r.stats.count > 0)
      .sort((a, b) => b.stats.net - a.stats.net)
      .map((r) => ({ label: r.strategy, value: r.stats.net })),
    split: [
      { label: "Wins", value: overall.wins, color: REPORT_COLORS.profit },
      { label: "Losses", value: overall.losses, color: REPORT_COLORS.loss },
      { label: "Breakeven", value: Math.max(0, overall.count - overall.wins - overall.losses), color: REPORT_COLORS.axis },
    ],
  };
}

/* The chart section, in whichever rendering the target engine can actually
   draw: real SVG for the PDF and the interactive HTML (both rendered by a
   browser), coloured table cells for Word, which drops inline SVG without a
   word of warning. The Word equity "curve" is therefore a bar per close,
   measured from the starting balance — the shape a bar table can carry. */
export function reportChartsHtml(data: ReportChartData, overall: SummaryStats, opts: { forWord?: boolean; startingBalance?: number } = {}): string {
  const { forWord = false, startingBalance = 0 } = opts;
  const money = (v: number) => fmtSignedCurrency(v);
  const block = (title: string, body: string) => `<div class="chart-block"><h3>${title}</h3>${body}</div>`;
  const noStrategy = "No strategy tagged on a closed trade yet.";
  if (forWord) {
    return block("Equity Curve", htmlBarRows(data.curve.slice(1).map((p) => ({ ...p, value: p.value - startingBalance })), { format: money, empty: "No closed trades yet." }))
      + block("P&amp;L by Month", htmlBarRows(data.monthly, { format: money }))
      + block("P&amp;L by Strategy", htmlBarRows(data.strategies, { format: money, empty: noStrategy }));
  }
  return block("Equity Curve", svgLineChart(data.curve))
    + `<div class="chart-row">`
    + `<div class="chart-block chart-half"><h3>Win / Loss Split</h3>${svgDonut(data.split, {
      centerLabel: overall.winRate !== null ? fmtPercent(overall.winRate, 1) : "—",
      centerSub: `${overall.count} closed`,
    })}${chartLegend(data.split)}</div>`
    + `<div class="chart-block chart-half"><h3>P&amp;L by Strategy</h3>${htmlBarRows(data.strategies, { format: money, empty: noStrategy })}</div>`
    + `</div>`
    + block("P&amp;L by Month", svgBarChart(data.monthly, { empty: "No closed trades yet." }));
}

export interface InteractiveReportInput {
  reportName: string;
  scopeLabel?: string;
  scopeNote: string;          // "All trades" / "Filtered selection"
  generatedAt: string;        // already formatted in the journal's timezone
  trades: ComputedTrade[];
  startingBalance: number;
  overall: SummaryStats;
  points: EquityPoint[];
  maxDD: number;
  maxDDPct: number;
  includeShots?: boolean;
  shotsByTrade?: Record<string, ReportShot[]>;
}

/* One self-contained .html file — no network, no libraries, nothing to install
   — that opens in any browser with the charts drawn and the trade table live:
   type to search, filter by direction / result / strategy, click a header to
   sort, and the count strip re-totals whatever is left showing.

   Everything the script needs rides on each row as data-* attributes, so the
   table is complete and readable with scripting off; the script only reorders
   and hides rows that are already there. */
export function interactiveReportHtml(input: InteractiveReportInput): string {
  const {
    reportName, scopeLabel = "", scopeNote, generatedAt, trades, startingBalance,
    overall, points, maxDD, maxDDPct, includeShots = false, shotsByTrade = {},
  } = input;
  const balance = startingBalance + overall.net;
  const charts = reportChartsHtml(reportChartData(trades, points, overall), overall);
  const strategies = [...new Set(trades.map((t) => t.strategy).filter(Boolean))].sort() as string[];
  const money = (v: number | null) => fmtSignedCurrency(v ?? 0);
  const card = (label: string, value: string, tone = "") => `<div class="kpi"><span class="kpi-label">${label}</span><span class="kpi-value ${tone}">${value}</span></div>`;

  const rows = trades.map((t) => {
    const pnl = t.pnlAmount as number | null;
    const open = t.status !== "Closed";
    const searchText = `${t.id} ${t.symbol} ${t.strategy || ""} ${t.notes || ""} ${(t.tags || []).join(" ")}`.toLowerCase();
    return `<tr data-symbol="${escapeHtml(t.symbol)}" data-dir="${escapeHtml(t.direction)}" data-result="${escapeHtml(open ? "open" : t.result || "breakeven")}"`
      + ` data-strategy="${escapeHtml(t.strategy || "")}" data-pnl="${open || pnl === null ? "" : pnl}" data-rr="${t.actualRR ?? ""}"`
      + ` data-ts="${t.entryDateTime ? new Date(t.entryDateTime).getTime() || 0 : 0}" data-text="${escapeHtml(searchText)}">`
      + `<td class="mono">${escapeHtml(t.id)}</td>`
      + `<td><b>${escapeHtml(t.symbol)}</b><span class="sub">${escapeHtml(t.marketType)}</span></td>`
      + `<td><span class="pill pill-${t.direction === "Long" ? "long" : "short"}">${escapeHtml(t.direction)}</span></td>`
      + `<td>${escapeHtml(t.strategy || "—")}</td>`
      + `<td class="mono">${t.entryDateTime ? fmtDate(t.entryDateTime) : "—"}</td>`
      + `<td class="mono">${t.exitDateTime ? fmtDate(t.exitDateTime) : "—"}</td>`
      + `<td class="mono num ${open ? "muted" : (pnl ?? 0) >= 0 ? "up" : "down"}">${open ? "open" : money(pnl)}</td>`
      + `<td class="mono num">${t.actualRR !== null ? `${fmtNum(t.actualRR)}R` : "—"}</td>`
      + `<td>${escapeHtml(t.grade || "—")}</td></tr>`;
  }).join("");

  const shotsHtml = includeShots
    ? trades.filter((t) => shotsByTrade[t.id]?.length).map((t) => `<h3>${escapeHtml(t.id)} — ${escapeHtml(t.symbol)}</h3>`
      + shotsByTrade[t.id].map((s) => `<figure><figcaption>${escapeHtml(s.stage)}</figcaption><img src="${escapeHtml(s.dataUrl)}" alt="${escapeHtml(`${t.id} ${s.stage}`)}" /></figure>`).join("")).join("")
    : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(reportName)} — Interactive Report</title>
<style>
:root { --ink:${REPORT_COLORS.ink}; --text:${REPORT_COLORS.text}; --muted:${REPORT_COLORS.axis}; --line:${REPORT_COLORS.grid}; --accent:${REPORT_COLORS.accent}; --up:${REPORT_COLORS.profit}; --down:${REPORT_COLORS.loss}; --panel:#fff; --page:#F5F7FA; }
* { box-sizing: border-box; }
body { margin:0; background:var(--page); color:var(--ink); font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
.wrap { max-width:1180px; margin:0 auto; padding:26px 20px 60px; }
h1 { font-size:23px; margin:0; } h2 { font-size:15px; margin:26px 0 10px; padding-bottom:6px; border-bottom:1px solid var(--line); }
h3 { font-size:12px; color:var(--text); margin:14px 0 6px; font-weight:600; }
.meta { color:var(--muted); font-size:12px; margin:4px 0 20px; }
.panel { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin-bottom:16px; }
.kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; }
.kpi { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:11px 13px; display:flex; flex-direction:column; gap:3px; }
.kpi-label { font-size:10.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); }
.kpi-value { font-size:19px; font-weight:700; font-variant-numeric:tabular-nums; }
.up { color:var(--up); } .down { color:var(--down); } .muted { color:var(--muted); }
.controls { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:12px; }
.controls input, .controls select { font:inherit; font-size:13px; padding:7px 10px; border:1px solid var(--line); border-radius:8px; background:#fff; color:var(--ink); }
.controls input { flex:1; min-width:200px; }
.count { color:var(--muted); font-size:12px; margin-left:auto; }
table { width:100%; border-collapse:collapse; }
th, td { padding:8px 10px; text-align:left; border-bottom:1px solid var(--line); font-size:12.5px; vertical-align:middle; }
th { position:sticky; top:0; background:var(--panel); font-size:10.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); cursor:pointer; user-select:none; white-space:nowrap; }
th:hover { color:var(--ink); } th[aria-sort] { color:var(--accent); }
th[aria-sort="ascending"]::after { content:" \\2191"; } th[aria-sort="descending"]::after { content:" \\2193"; }
tbody tr:hover { background:#F8FAFD; }
.num { text-align:right; font-variant-numeric:tabular-nums; }
.mono { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
.sub { display:block; font-size:10.5px; color:var(--muted); }
.pill { display:inline-block; padding:1px 8px; border-radius:999px; font-size:10.5px; font-weight:600; border:1px solid var(--line); }
.pill-long { color:var(--up); border-color:var(--up); } .pill-short { color:var(--down); border-color:var(--down); }
.table-scroll { overflow-x:auto; max-height:70vh; overflow-y:auto; }
figure { margin:0 0 14px; } figure img { max-width:100%; border:1px solid var(--line); border-radius:8px; }
figcaption { font-size:11px; color:var(--muted); margin-bottom:4px; }
.empty-row td { text-align:center; color:var(--muted); padding:24px; }
@media print { body { background:#fff; } .controls { display:none; } .table-scroll { max-height:none; } }
${REPORT_CHART_CSS}
</style></head>
<body><div class="wrap">
<h1>${escapeHtml(reportName)}</h1>
<p class="meta">Interactive performance report${scopeLabel ? ` · ${escapeHtml(scopeLabel)}` : ""} · ${escapeHtml(scopeNote)} · Generated ${escapeHtml(generatedAt)}</p>
<div class="kpis">
  ${card("Balance", fmtCurrency(balance))}
  ${card("Total P&amp;L", money(overall.net), overall.net >= 0 ? "up" : "down")}
  ${card("Win Rate", overall.winRate !== null ? fmtPercent(overall.winRate, 1) : "—")}
  ${card("Trades", String(trades.length))}
  ${card("Avg RR", overall.avgRR !== null ? `${fmtNum(overall.avgRR)}R` : "—")}
  ${card("Profit Factor", fmtProfitFactor(overall.profitFactor))}
  ${card("Max Drawdown", `${fmtCurrency(maxDD)} · ${fmtNum(maxDDPct, 1)}%`)}
</div>
<h2>Charts</h2>
<div class="panel">${charts}</div>
<h2>Trades</h2>
<div class="panel">
  <div class="controls">
    <input id="q" type="search" placeholder="Search symbol, strategy, note, tag or id…" aria-label="Search trades">
    <select id="dir" aria-label="Direction"><option value="">Both directions</option><option value="Long">Long</option><option value="Short">Short</option></select>
    <select id="res" aria-label="Result"><option value="">Any result</option><option value="win">Wins</option><option value="loss">Losses</option><option value="breakeven">Breakeven</option><option value="open">Open</option></select>
    <select id="strat" aria-label="Strategy"><option value="">Any strategy</option>${strategies.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}</select>
    <span class="count" id="count"></span>
  </div>
  <div class="table-scroll"><table id="trades">
    <thead><tr>
      <th data-key="text">ID</th><th data-key="symbol">Symbol</th><th data-key="dir">Direction</th><th data-key="strategy">Strategy</th>
      <th data-key="ts" data-num="1">Entry</th><th data-key="ts" data-num="1">Exit</th>
      <th data-key="pnl" data-num="1" class="num">P&amp;L</th><th data-key="rr" data-num="1" class="num">RR</th><th data-key="text">Grade</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
</div>
${shotsHtml ? `<h2>Screenshots</h2><div class="panel">${shotsHtml}</div>` : ""}
</div>
<script>
(function () {
  var table = document.getElementById("trades");
  var body = table.tBodies[0];
  var all = Array.prototype.slice.call(body.rows);
  var q = document.getElementById("q"), dir = document.getElementById("dir"), res = document.getElementById("res"), strat = document.getElementById("strat");
  var count = document.getElementById("count");
  var empty = null, sortKey = "", sortDir = 1;

  function money(v) { return (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(2); }
  function visible() {
    var text = q.value.trim().toLowerCase();
    return all.filter(function (row) {
      if (text && row.getAttribute("data-text").indexOf(text) === -1) return false;
      if (dir.value && row.getAttribute("data-dir") !== dir.value) return false;
      if (res.value && row.getAttribute("data-result") !== res.value) return false;
      if (strat.value && row.getAttribute("data-strategy") !== strat.value) return false;
      return true;
    });
  }
  function render() {
    var rows = visible();
    if (sortKey) {
      var numeric = sortKey === "pnl" || sortKey === "rr" || sortKey === "ts";
      rows = rows.slice().sort(function (a, b) {
        var x = a.getAttribute("data-" + sortKey) || "", y = b.getAttribute("data-" + sortKey) || "";
        if (numeric) {
          // A blank — an open trade's P&L, a missing RR — always sorts last,
          // whichever way the column is pointing.
          if (x === "" && y === "") return 0;
          if (x === "") return 1;
          if (y === "") return -1;
          return (parseFloat(x) - parseFloat(y)) * sortDir;
        }
        return x.localeCompare(y) * sortDir;
      });
    }
    while (body.firstChild) body.removeChild(body.firstChild);
    rows.forEach(function (row) { body.appendChild(row); });
    if (!rows.length) {
      if (!empty) {
        empty = document.createElement("tr");
        empty.className = "empty-row";
        var cell = document.createElement("td");
        cell.colSpan = 9;
        cell.textContent = "No trade matches these filters.";
        empty.appendChild(cell);
      }
      body.appendChild(empty);
    }
    var net = 0, wins = 0, closed = 0;
    rows.forEach(function (row) {
      var raw = row.getAttribute("data-pnl");
      if (!raw) return;
      net += parseFloat(raw); closed++;
      if (row.getAttribute("data-result") === "win") wins++;
    });
    count.textContent = rows.length + " of " + all.length + " trades · net " + money(net)
      + (closed ? " · " + ((wins / closed) * 100).toFixed(1) + "% win rate" : "");
  }
  [q, dir, res, strat].forEach(function (el) { el.addEventListener("input", render); });
  Array.prototype.forEach.call(table.tHead.rows[0].cells, function (th) {
    th.addEventListener("click", function () {
      var key = th.getAttribute("data-key");
      sortDir = sortKey === key && sortDir === 1 ? -1 : 1;
      sortKey = key;
      Array.prototype.forEach.call(table.tHead.rows[0].cells, function (other) { other.removeAttribute("aria-sort"); });
      th.setAttribute("aria-sort", sortDir === 1 ? "ascending" : "descending");
      render();
    });
  });
  render();
})();
</script>
</body></html>`;
}
