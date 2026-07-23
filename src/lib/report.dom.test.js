// @vitest-environment jsdom
/**
 * The interactive report's own behaviour — the script that ships inside the
 * exported .html file. report.test.js proves the markup; this proves the page
 * actually works once a browser runs it: search narrows, the filters compose,
 * a header click sorts (blanks last, whichever way it points), and the count
 * strip re-totals what is left showing.
 *
 * The script is executed the way the browser would: pulled out of the document
 * and run against this file's jsdom document. jsdom does not run inline
 * <script> tags for us (vitest's environment leaves runScripts off), and
 * enabling it globally would let any fixture's markup execute — this keeps the
 * one deliberate eval in plain sight.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { interactiveReportHtml } from "./report";
import { computeTrade, summarize, equityCurve, maxDrawdown } from "./trade";

const trade = (over = {}) => computeTrade({
  id: "TJ-00001", symbol: "BTCUSDT", direction: "Long", status: "Closed", marketType: "Crypto", grade: "A",
  entryPrice: "100", exitPrice: "110", stopLoss: "95", positionSize: "1", strategy: "ICT",
  entryDateTime: "2026-07-10T09:00", exitDateTime: "2026-07-10T11:00", ...over,
});

const TRADES = [
  trade({ id: "TJ-1", symbol: "BTCUSDT", exitPrice: "110" }),                                                  // +10 win
  trade({ id: "TJ-2", symbol: "EURUSD", exitPrice: "70", strategy: "Scalping", entryDateTime: "2026-07-11T09:00", exitDateTime: "2026-07-11T11:00" }), // -30 loss
  trade({ id: "TJ-3", symbol: "XAUUSD", exitPrice: "105", entryDateTime: "2026-07-12T09:00", exitDateTime: "2026-07-12T11:00" }), // +5 win
  trade({ id: "TJ-4", symbol: "NAS100", status: "Open", exitPrice: "", exitDateTime: "", strategy: "", entryDateTime: "2026-07-13T09:00" }),
];

// The trade rows only — the "nothing matches" row is a tbody row too.
const ids = () => [...document.querySelectorAll("#trades tbody tr:not(.empty-row)")].map((r) => r.cells[0].textContent);
const set = (id, value) => {
  const el = document.getElementById(id);
  el.value = value;
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
};

beforeEach(() => {
  const points = equityCurve(TRADES, 1000);
  const { maxDD, maxDDPct } = maxDrawdown(points);
  const html = interactiveReportHtml({
    reportName: "Trade Journal", scopeNote: "All trades", generatedAt: "Jul 22, 2026, 8:00 PM",
    trades: TRADES, startingBalance: 1000, overall: summarize(TRADES), points, maxDD, maxDDPct,
  });
  document.documentElement.innerHTML = html.slice(html.indexOf("<head"));
  const script = document.querySelector("script").textContent;
  document.querySelector("script").remove();
  new Function(script)(); // the report's own script, run the way a browser would
});

describe("interactive report — search and filters", () => {
  it("opens with every trade showing", () => {
    expect(ids()).toEqual(["TJ-1", "TJ-2", "TJ-3", "TJ-4"]);
    expect(document.getElementById("count").textContent).toContain("4 of 4 trades");
  });

  it("narrows to a symbol as it is typed, and restores on clear", () => {
    set("q", "eurusd");
    expect(ids()).toEqual(["TJ-2"]);
    set("q", "");
    expect(ids()).toHaveLength(4);
  });

  it("filters by result, counting an open trade as its own result", () => {
    set("res", "win");
    expect(ids()).toEqual(["TJ-1", "TJ-3"]);
    set("res", "open");
    expect(ids()).toEqual(["TJ-4"]);
  });

  it("composes the filters rather than replacing one with the next", () => {
    set("res", "win");
    set("strat", "ICT");
    expect(ids()).toEqual(["TJ-1", "TJ-3"]);
    set("strat", "Scalping");
    expect(ids()).toEqual([]);
    expect(document.querySelector(".empty-row").textContent).toMatch(/no trade matches/i);
  });

  it("re-totals the count strip over what is showing, not the whole journal", () => {
    const count = document.getElementById("count");
    expect(count.textContent).toContain("net -$15.00");
    set("res", "win");
    expect(count.textContent).toContain("2 of 4 trades");
    expect(count.textContent).toContain("net $15.00");
    expect(count.textContent).toContain("100.0% win rate");
  });
});

describe("interactive report — sorting", () => {
  const clickHeader = (label) => {
    const th = [...document.querySelectorAll("#trades thead th")].find((h) => h.textContent.replace("&", "&").trim().toLowerCase().startsWith(label));
    th.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    return th;
  };

  it("sorts by P&L ascending, then descending on a second click", () => {
    clickHeader("p&l");
    expect(ids().slice(0, 3)).toEqual(["TJ-2", "TJ-3", "TJ-1"]);
    clickHeader("p&l");
    expect(ids().slice(0, 3)).toEqual(["TJ-1", "TJ-3", "TJ-2"]);
  });

  // An open trade has no P&L; it must not read as a $0.00 sitting between the
  // losers and the winners, in either direction.
  it("keeps a blank value last whichever way the column points", () => {
    clickHeader("p&l");
    expect(ids()[3]).toBe("TJ-4");
    clickHeader("p&l");
    expect(ids()[3]).toBe("TJ-4");
  });

  it("marks the sorted column for assistive tech, and only that column", () => {
    const pnl = clickHeader("p&l");
    expect(pnl.getAttribute("aria-sort")).toBe("ascending");
    const symbol = clickHeader("symbol");
    expect(pnl.hasAttribute("aria-sort")).toBe(false);
    expect(symbol.getAttribute("aria-sort")).toBe("ascending");
    expect(ids()).toEqual(["TJ-1", "TJ-2", "TJ-4", "TJ-3"]);
  });

  it("keeps the sort applied as the filters change", () => {
    clickHeader("p&l");
    set("res", "win");
    expect(ids()).toEqual(["TJ-3", "TJ-1"]);
  });
});
