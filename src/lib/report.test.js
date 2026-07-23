/**
 * The exported report documents. Everything here is a string builder, so the
 * assertions are on the document that lands on disk: that the charts are the
 * rendering the target engine can actually draw (SVG for the browser engines,
 * coloured table cells for Word), that every row carries the data-* the
 * interactive report's script sorts and filters on, and — the one that really
 * matters — that trader-typed text can never break out of the markup.
 */
import { describe, it, expect } from "vitest";
import { reportChartData, reportChartsHtml, interactiveReportHtml, REPORT_CHART_CSS } from "./report";
import { computeTrade, summarize, equityCurve, maxDrawdown } from "./trade";

const trade = (over = {}) => computeTrade({
  id: "TJ-00001", symbol: "BTCUSDT", direction: "Long", status: "Closed", marketType: "Crypto", grade: "A",
  entryPrice: "100", exitPrice: "110", stopLoss: "95", positionSize: "1", strategy: "ICT",
  entryDateTime: "2026-07-10T09:00", exitDateTime: "2026-07-10T11:00", ...over,
});

const journal = (list) => {
  const points = equityCurve(list, 1000);
  const { maxDD, maxDDPct } = maxDrawdown(points);
  return {
    reportName: "Trade Journal", scopeNote: "All trades", generatedAt: "Jul 22, 2026, 8:00 PM",
    trades: list, startingBalance: 1000, overall: summarize(list), points, maxDD, maxDDPct,
  };
};

const TRADES = [
  trade(),
  // Short from 100 to 110 — the loser of the pair.
  trade({ id: "TJ-00002", symbol: "EURUSD", direction: "Short", exitPrice: "110", stopLoss: "105", strategy: "Scalping", exitDateTime: "2026-08-02T11:00" }),
  trade({ id: "TJ-00003", symbol: "XAUUSD", status: "Open", exitPrice: "", exitDateTime: "", strategy: "" }),
];

describe("reportChartData", () => {
  it("builds the four series every report charts, closed trades only", () => {
    const data = reportChartData(TRADES, equityCurve(TRADES, 1000), summarize(TRADES));
    expect(data.curve[0]).toEqual({ label: "Start", value: 1000 });
    expect(data.curve).toHaveLength(3); // start + two closes; the open trade is not on the curve
    expect(data.monthly.map((m) => m.label)).toEqual(["Jul 2026", "Aug 2026"]);
    expect(data.split.map((s) => s.value)).toEqual([1, 1, 0]);
  });

  it("ranks strategies by net P&L and leaves the untagged trade out", () => {
    const data = reportChartData(TRADES, equityCurve(TRADES, 1000), summarize(TRADES));
    expect(data.strategies).toEqual([
      { label: "ICT", value: 10 },
      { label: "Scalping", value: -10 },
    ]);
  });

  it("survives a journal with nothing closed in it", () => {
    const open = [TRADES[2]];
    const data = reportChartData(open, equityCurve(open, 1000), summarize(open));
    expect(data.monthly).toEqual([]);
    expect(data.strategies).toEqual([]);
    expect(data.split.every((s) => s.value === 0)).toBe(true);
  });
});

describe("reportChartsHtml", () => {
  const data = reportChartData(TRADES, equityCurve(TRADES, 1000), summarize(TRADES));
  const overall = summarize(TRADES);

  it("draws real SVG for the browser-rendered reports", () => {
    const html = reportChartsHtml(data, overall);
    expect(html).toContain("<svg");
    expect(html).toContain("Equity Curve");
    expect(html).toContain("Win / Loss Split");
    expect(html).toContain("P&amp;L by Month");
  });

  it("puts the win rate in the donut's hole", () => {
    expect(reportChartsHtml(data, overall)).toContain(">50.0%<");
  });

  // Word's HTML importer drops inline SVG silently — a chart that isn't there
  // is worse than a plain bar table, so the Word path never emits any.
  it("emits no SVG at all on the Word path", () => {
    const html = reportChartsHtml(data, overall, { forWord: true, startingBalance: 1000 });
    expect(html).not.toContain("<svg");
    expect(html).toContain("bgcolor=");
    expect(html).toContain("Equity Curve");
  });

  it("measures the Word equity bars from the starting balance, not from zero", () => {
    const html = reportChartsHtml(data, overall, { forWord: true, startingBalance: 1000 });
    // First close takes 1000 -> 1010, i.e. +$10.00 against the start.
    expect(html).toContain("+$10.00");
    expect(html).not.toContain("$1,010.00");
  });
});

describe("interactiveReportHtml", () => {
  const html = interactiveReportHtml(journal(TRADES));

  it("is one self-contained document — no network, no libraries", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)="https?:/);
  });

  it("carries the headline figures", () => {
    expect(html).toContain("Total P&amp;L");
    expect(html).toContain("Win Rate");
    expect(html).toContain(">50.0%<");
  });

  it("renders every trade as a row, open ones included", () => {
    const rows = html.match(/<tr data-symbol=/g) || [];
    expect(rows).toHaveLength(3);
    expect(html).toContain("XAUUSD");
  });

  it("hangs the script's sort and filter keys off each row", () => {
    const row = html.match(/<tr data-symbol="BTCUSDT"[^>]*>/)[0];
    expect(row).toContain('data-dir="Long"');
    expect(row).toContain('data-result="win"');
    expect(row).toContain('data-strategy="ICT"');
    expect(row).toContain('data-pnl="10"');
    expect(row).toMatch(/data-ts="\d+"/);
    expect(row).toContain("btcusdt");
  });

  // The script sorts blanks last; an open trade has to *be* blank for that to
  // work, rather than reading as a $0.00 that outranks every real loss.
  it("leaves an open trade's P&L blank rather than zero", () => {
    const row = html.match(/<tr data-symbol="XAUUSD"[^>]*>/)[0];
    expect(row).toContain('data-pnl=""');
    expect(row).toContain('data-result="open"');
  });

  it("offers a filter option for each strategy actually used", () => {
    expect(html).toContain('<option value="ICT">ICT</option>');
    expect(html).toContain('<option value="Scalping">Scalping</option>');
  });

  it("ships the chart styling with it, since it is read outside the app", () => {
    expect(html).toContain(REPORT_CHART_CSS.trim().split("\n")[0]);
  });

  it("escapes trader-typed text everywhere it lands, attributes included", () => {
    const nasty = interactiveReportHtml(journal([trade({
      symbol: '<img src=x onerror=alert(1)>', strategy: '"><script>bad()</script>', notes: "5 < 6 & 7 > 6",
    })]));
    expect(nasty).not.toContain("<img src=x");
    expect(nasty).not.toContain("<script>bad()");
    expect(nasty).toContain("&lt;img src=x");
    // The one <script> in the document is the report's own behaviour.
    expect(nasty.match(/<script>/g)).toHaveLength(1);
  });

  it("renders a journal with no trades at all rather than throwing", () => {
    const empty = interactiveReportHtml(journal([]));
    expect(empty).toContain("chart-empty");
    expect(empty).toContain("<tbody></tbody>");
  });

  it("includes screenshots only when asked", () => {
    const shots = { "TJ-00001": [{ stage: "Entry", dataUrl: "data:image/png;base64,AAA" }] };
    expect(interactiveReportHtml({ ...journal(TRADES), shotsByTrade: shots })).not.toContain("<figure>");
    const withShots = interactiveReportHtml({ ...journal(TRADES), includeShots: true, shotsByTrade: shots });
    expect(withShots).toContain("<figure>");
    expect(withShots).toContain("data:image/png;base64,AAA");
  });
});
