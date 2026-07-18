/**
 * Feature tests for the journal's rules — everything in ./trade.
 *
 * The suite runs pinned to TZ=Asia/Kolkata (see the `test` script in
 * package.json), for two reasons. It makes every date assertion deterministic
 * instead of depending on whoever's machine runs it, and it matches the
 * timezone this journal is actually kept in. A suite left on the host default
 * would go green on any UTC machine and hide the day-bucketing bugs below,
 * which is precisely how they survived this long.
 *
 * KNOWN-FAILING tests are marked `BUG:` and assert the *correct* behaviour, not
 * the current behaviour. They are red on purpose — they document real defects
 * found reviewing App.jsx, and they turn green when the defect is fixed. Do not
 * "fix" them by rewriting the expectation to match what the code does today.
 * (None outstanding right now; the tag comes back with the next live defect.)
 */
import { describe, it, expect } from "vitest";
import {
  computeTrade, aggregateLegs, stripComputed, COMPUTED_TRADE_KEYS,
  summarize, equityCurve, maxDrawdown, consecutiveStreaks, sharpeSortino,
  groupPerformance, goalProgress,
  normalizeAccounts, mergeSettings, mergePreferences, clampZoom, stepZoom, paletteFilter, normalizeAccent,
  DEFAULT_ACCOUNT_ID, DEFAULT_ACCOUNT_BALANCE, DEFAULT_SETTINGS, DEFAULT_PREFERENCES,
  shardOf, shardKey, djb2, SHARD_COUNT, nextTradeId, tradeSeq,
  parseCSV, csvCell, tradesToCSV, rowsToTrades, normalizeCsvDate, partitionDuplicateImports, escapeHtml,
  isoDate, isoWeekKey, monthKey, weekOfMonthKey, durationLabel,
  dateInRange, dateRangeForPreset, startOfWeek, toLocalInputValue,
  zonedNow, isValidTimeZone, normalizeTimezone, tzOffsetLabel,
  journalEntries, journalToMarkdown, journalToCSV, journalToHtml, filterJournalEntries,
  normalizeChartCount, CHART_PERIOD_CHOICES,
  emptyTrade, tradeToForm, withDerivedFills, formSignature, tradeWarnings,
} from "./trade";

// A closed long: in at 100, out at 110, 2 units, stop 95, target 120.
const baseTrade = (over = {}) => ({
  id: "TJ-00001", accountId: DEFAULT_ACCOUNT_ID, symbol: "BTCUSD", marketType: "Crypto",
  direction: "Long", status: "Closed",
  entryPrice: "100", stopLoss: "95", takeProfit: "120", exitPrice: "110",
  positionSize: "2", fees: "", commission: "", swap: "", riskAmount: "10",
  entryDateTime: "2026-07-16T09:00", exitDateTime: "2026-07-16T11:00",
  entries: [], exits: [], tags: [], checklist: {}, notes: "", grade: "B", strategy: "ICT",
  ...over,
});

describe("computeTrade — P&L and RR", () => {
  it("derives P&L, RR and result for a winning long", () => {
    const t = computeTrade(baseTrade());
    expect(t.grossPnl).toBe(20);        // (110 - 100) * 2
    expect(t.pnlAmount).toBe(20);       // no fees
    expect(t.pnlPercent).toBe(10);      // 20 / (100 * 2) * 100
    expect(t.result).toBe("win");
    expect(t.stopDistance).toBe(5);
    expect(t.expectedRR).toBe(4);       // (120 - 100) / 5
    expect(t.actualRR).toBe(2);         // (110 - 100) / 5
  });

  it("inverts direction for a winning short", () => {
    const t = computeTrade(baseTrade({ direction: "Short", exitPrice: "90", stopLoss: "105", takeProfit: "80" }));
    expect(t.grossPnl).toBe(20);        // (100 - 90) * 2
    expect(t.result).toBe("win");
    expect(t.expectedRR).toBe(4);       // (100 - 80) / 5
    expect(t.actualRR).toBe(2);         // (100 - 90) / 5
  });

  it("books a losing long as a loss", () => {
    const t = computeTrade(baseTrade({ exitPrice: "95" }));
    expect(t.pnlAmount).toBe(-10);
    expect(t.result).toBe("loss");
    expect(t.actualRR).toBe(-1);
  });

  it("calls an exactly flat trade breakeven, not a win", () => {
    const t = computeTrade(baseTrade({ exitPrice: "100" }));
    expect(t.pnlAmount).toBe(0);
    expect(t.result).toBe("breakeven");
  });

  it("leaves an open trade with no P&L and no actual RR, even with an exit price on file", () => {
    const t = computeTrade(baseTrade({ status: "Open" }));
    expect(t.pnlAmount).toBeNull();
    expect(t.result).toBeNull();
    expect(t.actualRR).toBeNull();
    expect(t.expectedRR).toBe(4);       // the plan is still knowable
  });

  it("yields no RR when stop equals entry (no risk distance to divide by)", () => {
    const t = computeTrade(baseTrade({ stopLoss: "100" }));
    expect(t.stopDistance).toBeNull();
    expect(t.expectedRR).toBeNull();
    expect(t.actualRR).toBeNull();
  });

  it("caches against the source object", () => {
    const raw = baseTrade();
    expect(computeTrade(raw)).toBe(computeTrade(raw));
  });
});

describe("computeTrade — fees", () => {
  it("sums commission and swap into the total when the split is used", () => {
    const t = computeTrade(baseTrade({ commission: "3", swap: "1" }));
    expect(t._fees).toBe(4);
    expect(t.pnlAmount).toBe(16);       // 20 gross - 4
    expect(t._commission).toBe(3);
    expect(t._swap).toBe(1);
  });

  it("treats a blank half of the split as zero rather than absent", () => {
    const t = computeTrade(baseTrade({ commission: "2", swap: "" }));
    expect(t._fees).toBe(2);
    expect(t._swap).toBe(0);
  });

  it("reads a pre-split journal's `fees` as the total", () => {
    const t = computeTrade(baseTrade({ fees: "5" }));
    expect(t._fees).toBe(5);
    expect(t.pnlAmount).toBe(15);
    expect(t._commission).toBeNull();   // signals "this trade has no split"
    expect(t._swap).toBeNull();
  });

  it("lets the split outrank a stale `fees` total", () => {
    const t = computeTrade(baseTrade({ fees: "99", commission: "1", swap: "1" }));
    expect(t._fees).toBe(2);
  });
});

describe("aggregateLegs — scaled fills", () => {
  it("returns the size-weighted average price and total quantity", () => {
    const fill = aggregateLegs([{ price: "100", qty: "1" }, { price: "90", qty: "1" }]);
    expect(fill.avgPrice).toBe(95);
    expect(fill.qty).toBe(2);
  });

  it("weights by size, not by leg count", () => {
    const fill = aggregateLegs([{ price: "100", qty: "3" }, { price: "80", qty: "1" }]);
    expect(fill.avgPrice).toBe(95);     // (300 + 80) / 4
    expect(fill.qty).toBe(4);
  });

  it("skips legs with no price rather than counting them as zero", () => {
    const fill = aggregateLegs([{ price: "100", qty: "1" }, { price: "", qty: "5" }]);
    expect(fill.avgPrice).toBe(100);
    expect(fill.qty).toBe(1);
  });

  it("skips non-positive quantities", () => {
    expect(aggregateLegs([{ price: "100", qty: "0" }])).toBeNull();
    expect(aggregateLegs([{ price: "100", qty: "-1" }])).toBeNull();
  });

  it("returns null for nothing usable, which is the signal to fall back to the flat fields", () => {
    expect(aggregateLegs([])).toBeNull();
    expect(aggregateLegs(null)).toBeNull();
    expect(aggregateLegs(undefined)).toBeNull();
  });

  it("spans the legs' timestamps regardless of the order they were entered", () => {
    const fill = aggregateLegs([
      { price: "100", qty: "1", datetime: "2026-07-16T11:00" },
      { price: "90", qty: "1", datetime: "2026-07-16T09:00" },
    ]);
    expect(fill.firstAt).toBe("2026-07-16T09:00");
    expect(fill.lastAt).toBe("2026-07-16T11:00");
  });
});

describe("computeTrade — scaled trades", () => {
  it("prefers legs over the flat price and size fields", () => {
    const t = computeTrade(baseTrade({
      entryPrice: "999", positionSize: "999",
      entries: [{ price: "100", qty: "1" }, { price: "90", qty: "1" }],
    }));
    expect(t._entry).toBe(95);
    expect(t._entryQty).toBe(2);
    expect(t._scaled).toBe(true);
  });

  it("realises P&L only on the size that both entered and left", () => {
    const t = computeTrade(baseTrade({
      entries: [{ price: "100", qty: "1" }, { price: "90", qty: "1" }],   // avg 95, qty 2
      exits: [{ price: "110", qty: "1" }],                                // scaled out half
    }));
    expect(t._entryQty).toBe(2);
    expect(t._exitQty).toBe(1);
    expect(t._qty).toBe(1);             // matched
    expect(t._openQty).toBe(1);         // still open
    expect(t._partial).toBe(true);
    expect(t.grossPnl).toBe(15);        // (110 - 95) * 1, not * 2
  });

  it("treats a fully closed scaled trade as having nothing open", () => {
    const t = computeTrade(baseTrade({
      entries: [{ price: "100", qty: "2" }],
      exits: [{ price: "110", qty: "1" }, { price: "120", qty: "1" }],    // avg 115, qty 2
    }));
    expect(t._qty).toBe(2);
    expect(t._openQty).toBe(0);
    expect(t._partial).toBe(false);
    expect(t.grossPnl).toBe(30);        // (115 - 100) * 2
  });

  it("takes the trade's real open and close times from the legs", () => {
    const t = computeTrade(baseTrade({
      entryDateTime: "2026-01-01T00:00", exitDateTime: "2026-01-01T00:00",
      entries: [{ price: "100", qty: "1", datetime: "2026-07-16T09:00" }],
      exits: [{ price: "110", qty: "1", datetime: "2026-07-16T11:30" }],
    }));
    expect(t.entryDateTime).toBe("2026-07-16T09:00");
    expect(t.exitDateTime).toBe("2026-07-16T11:30");
    expect(t.duration).toBe("2h 30m");
  });

  it("marks an unscaled trade as such", () => {
    const t = computeTrade(baseTrade());
    expect(t._scaled).toBe(false);
    expect(t._partial).toBe(false);
    expect(t._exitQty).toBe(2);         // no exit legs: the whole position left
  });
});

describe("stripComputed", () => {
  it("removes every derived field and keeps the record", () => {
    const core = stripComputed(computeTrade(baseTrade()));
    COMPUTED_TRADE_KEYS.forEach((k) => expect(core).not.toHaveProperty(k));
    expect(core.id).toBe("TJ-00001");
    expect(core.symbol).toBe("BTCUSD");
    expect(core.entryPrice).toBe("100");
  });

  it("survives a compute -> strip -> compute round trip unchanged", () => {
    const once = computeTrade(baseTrade());
    const twice = computeTrade(stripComputed(once));
    expect(twice.pnlAmount).toBe(once.pnlAmount);
    expect(twice.actualRR).toBe(once.actualRR);
  });
});

describe("summarize", () => {
  const closed = (pnl, result, rr = 1) => ({ status: "Closed", pnlAmount: pnl, pnlPercent: pnl / 10, result, actualRR: rr });

  it("counts wins, losses, win rate and profit factor", () => {
    const s = summarize([closed(100, "win"), closed(50, "win"), closed(-30, "loss")]);
    expect(s.count).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.winRate).toBeCloseTo(66.667, 2);
    expect(s.grossProfit).toBe(150);
    expect(s.grossLossAbs).toBe(30);
    expect(s.net).toBe(120);
    expect(s.profitFactor).toBe(5);
  });

  it("reports an unbeaten run as an infinite profit factor, not a divide by zero", () => {
    expect(summarize([closed(100, "win")]).profitFactor).toBe(Infinity);
  });

  it("returns nulls, not zeroes, for an empty journal", () => {
    const s = summarize([]);
    expect(s.count).toBe(0);
    expect(s.winRate).toBeNull();
    expect(s.profitFactor).toBeNull();
    expect(s.avgRR).toBeNull();
  });

  it("ignores open trades", () => {
    const s = summarize([closed(100, "win"), { status: "Open", pnlAmount: null }]);
    expect(s.count).toBe(1);
  });

  it("averages only the RRs that exist", () => {
    const s = summarize([closed(100, "win", 2), closed(-30, "loss", null)]);
    expect(s.avgRR).toBe(2);
  });
});

describe("equity curve and drawdown", () => {
  const closed = (pnl, exitDateTime) => ({ status: "Closed", pnlAmount: pnl, exitDateTime });

  it("starts at the opening balance and walks the closes in time order", () => {
    const points = equityCurve([
      closed(-50, "2026-07-17T10:00"),
      closed(100, "2026-07-16T10:00"),
    ], 1000);
    expect(points.map((p) => p.balance)).toEqual([1000, 1100, 1050]);
    expect(points[0].date).toBe("Start");
  });

  it("ignores open trades and trades with no exit time", () => {
    const points = equityCurve([
      closed(100, "2026-07-16T10:00"),
      { status: "Open", pnlAmount: null, exitDateTime: "" },
      closed(50, ""),
    ], 1000);
    expect(points).toHaveLength(2);
  });

  it("measures the deepest fall from a peak", () => {
    const dd = maxDrawdown([{ balance: 1000 }, { balance: 1100 }, { balance: 1050 }]);
    expect(dd.maxDD).toBe(50);
    expect(dd.maxDDPct).toBeCloseTo(4.545, 2);
  });

  it("reports no drawdown on a curve that only rises", () => {
    expect(maxDrawdown([{ balance: 1000 }, { balance: 1200 }]).maxDD).toBe(0);
  });
});

describe("consecutiveStreaks", () => {
  const closed = (result, exitDateTime) => ({ status: "Closed", result, exitDateTime });

  it("tracks the longest and current runs", () => {
    const s = consecutiveStreaks([
      closed("win", "2026-07-01T10:00"),
      closed("win", "2026-07-02T10:00"),
      closed("loss", "2026-07-03T10:00"),
      closed("win", "2026-07-04T10:00"),
    ]);
    expect(s.maxWin).toBe(2);
    expect(s.maxLoss).toBe(1);
    expect(s.currentWin).toBe(1);
    expect(s.currentLoss).toBe(0);
  });

  it("does not let a breakeven break a run", () => {
    const s = consecutiveStreaks([
      closed("win", "2026-07-01T10:00"),
      closed("breakeven", "2026-07-02T10:00"),
      closed("win", "2026-07-03T10:00"),
    ]);
    expect(s.maxWin).toBe(2);
  });
});

describe("sharpeSortino", () => {
  it("returns nulls with no data or no balance to measure against", () => {
    expect(sharpeSortino([], 1000)).toEqual({ sharpe: null, sortino: null });
    expect(sharpeSortino([10, -5], 0)).toEqual({ sharpe: null, sortino: null });
  });

  it("scores a mixed run finitely, with sortino above sharpe when upside dominates", () => {
    const { sharpe, sortino } = sharpeSortino([100, -20, 50, 30], 10000);
    expect(Number.isFinite(sharpe)).toBe(true);
    expect(sortino).toBeGreaterThan(sharpe);
  });

  it("declines to score a run with no variance", () => {
    expect(sharpeSortino([10, 10, 10], 1000).sharpe).toBeNull();
  });

  it("returns no sortino when nothing ever lost", () => {
    expect(sharpeSortino([10, 20, 30], 1000).sortino).toBeNull();
  });
});

describe("groupPerformance", () => {
  it("rolls trades up per bucket with its own stats", () => {
    const rows = groupPerformance([
      { status: "Closed", pnlAmount: 100, pnlPercent: 10, result: "win", exitDateTime: "2026-07-16T10:00" },
      { status: "Closed", pnlAmount: -30, pnlPercent: -3, result: "loss", exitDateTime: "2026-07-17T10:00" },
    ], () => ({ key: "2026-07", label: "Jul 2026", sortKey: "2026-07" }), "month");
    expect(rows).toHaveLength(1);
    expect(rows[0].month).toBe("Jul 2026");
    expect(rows[0].pnl).toBe(70);
    expect(rows[0].trades).toBe(2);
    expect(rows[0].wins).toBe(1);
    expect(rows[0].winRate).toBe(50);
    expect(rows[0].profitFactor).toBeCloseTo(3.333, 2);
  });

  it("sorts buckets by their sort key", () => {
    const rows = groupPerformance([
      { status: "Closed", pnlAmount: 1, result: "win", exitDateTime: "2026-08-01T10:00" },
      { status: "Closed", pnlAmount: 1, result: "win", exitDateTime: "2026-07-01T10:00" },
    ], (d) => monthKey(d), "month");
    expect(rows.map((r) => r.month)).toEqual(["2026-07", "2026-08"]);
  });
});

describe("goalProgress", () => {
  it("reports progress as a clamped percentage", () => {
    expect(goalProgress(50, 100)).toBe(50);
    expect(goalProgress(150, 100)).toBe(100);
    expect(goalProgress(-10, 100)).toBe(0);
  });

  it("does not divide by a zero target", () => {
    expect(Number.isFinite(goalProgress(50, 0))).toBe(true);
  });
});

describe("accounts", () => {
  it("folds a pre-accounts journal into one account under the id legacy trades resolve to", () => {
    const list = normalizeAccounts(undefined, 5000);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(DEFAULT_ACCOUNT_ID);
    expect(list[0].startingBalance).toBe(5000);
  });

  it("falls back to the default balance when the journal has none", () => {
    expect(normalizeAccounts(undefined, undefined)[0].startingBalance).toBe(DEFAULT_ACCOUNT_BALANCE);
  });

  it("never returns an empty list, whatever it is handed", () => {
    [null, [], "nonsense", [null], [42]].forEach((input) => {
      expect(normalizeAccounts(input, 100).length).toBeGreaterThan(0);
    });
  });

  it("gives every account an id and a name, so a hand-edited backup still resolves", () => {
    const list = normalizeAccounts([{ startingBalance: 1 }, { name: "  ", startingBalance: 2 }], 0);
    list.forEach((a) => {
      expect(a.id).toBeTruthy();
      expect(a.name).toBeTruthy();
    });
    expect(list[1].name).toBe("Account 2");
  });

  it("coerces an unparseable balance to zero rather than NaN", () => {
    expect(normalizeAccounts([{ id: "a", startingBalance: "abc" }], 0)[0].startingBalance).toBe(0);
  });
});

describe("mergeSettings", () => {
  it("mirrors the first account's balance onto the legacy top-level field", () => {
    const s = mergeSettings({ accounts: [{ id: "a", startingBalance: 500 }, { id: "b", startingBalance: 900 }] });
    expect(s.startingBalance).toBe(500);
  });

  it("promotes a pre-accounts balance into the account list", () => {
    const s = mergeSettings({ startingBalance: 7000 });
    expect(s.accounts[0].id).toBe(DEFAULT_ACCOUNT_ID);
    expect(s.accounts[0].startingBalance).toBe(7000);
    expect(s.startingBalance).toBe(7000);
  });

  // A journal from before the timezone setting has no such key; it must load
  // as "follow the machine", which is exactly how those journals behaved.
  it("defaults a pre-timezone journal to the machine zone", () => {
    expect(mergeSettings({ startingBalance: 7000 }).timezone).toBe("");
  });

  it("keeps a valid journal timezone and drops an unknown one", () => {
    expect(mergeSettings({ timezone: "America/New_York" }).timezone).toBe("America/New_York");
    expect(mergeSettings({ timezone: "Atlantis/Sunken" }).timezone).toBe("");
  });

  it("normalizes strategy notes to a clean map of non-blank strings", () => {
    const s = mergeSettings({ strategyNotes: { ICT: "  liquidity sweep entry ", Empty: "   ", Num: 7 } });
    expect(s.strategyNotes).toEqual({ ICT: "  liquidity sweep entry " });
    expect(mergeSettings({ strategyNotes: ["not", "a", "map"] }).strategyNotes).toEqual({});
    expect(mergeSettings({}).strategyNotes).toEqual({});
  });

  it("caps a strategy note's length", () => {
    const s = mergeSettings({ strategyNotes: { A: "x".repeat(9000) } });
    expect(s.strategyNotes.A.length).toBe(5000);
  });

  it("fills in goals and checklist rules that a journal never had", () => {
    const s = mergeSettings({});
    expect(s.goals).toEqual(DEFAULT_SETTINGS.goals);
    expect(s.checklistRules).toEqual(DEFAULT_SETTINGS.checklistRules);
  });

  it("keeps the goals a journal does have, and backfills only the missing ones", () => {
    const s = mergeSettings({ goals: { winRate: 70 } });
    expect(s.goals.winRate).toBe(70);
    expect(s.goals.profitFactor).toBe(DEFAULT_SETTINGS.goals.profitFactor);
  });

  it("survives being handed nothing at all", () => {
    expect(mergeSettings(undefined).accounts).toHaveLength(1);
  });

  it("defaults the journal name and tagline to empty for a journal that never set them", () => {
    const s = mergeSettings({});
    expect(s.journalName).toBe("");
    expect(s.journalTagline).toBe("");
  });

  it("trims the journal name and caps its length", () => {
    expect(mergeSettings({ journalName: "  My Desk  " }).journalName).toBe("My Desk");
    expect(mergeSettings({ journalName: "x".repeat(100) }).journalName).toHaveLength(40);
    expect(mergeSettings({ journalTagline: "y".repeat(100) }).journalTagline).toHaveLength(60);
  });

  it("coerces a non-string journal name to empty rather than crashing the brand", () => {
    expect(mergeSettings({ journalName: 42 }).journalName).toBe("");
    expect(mergeSettings({ journalName: null }).journalName).toBe("");
  });
});

describe("mergePreferences", () => {
  it("defaults an empty journal's preferences", () => {
    expect(mergePreferences(undefined).selectedTab).toBe(DEFAULT_PREFERENCES.selectedTab);
    expect(mergePreferences({}).activeAccountId).toBe("");
  });

  it("lifts the older flat calendar fields into the calendar object", () => {
    const p = mergePreferences({ calendarView: "weekly", calendarCursor: "2026-07-16" });
    expect(p.calendar.view).toBe("weekly");
    expect(p.calendar.cursor).toBe("2026-07-16");
  });

  // Only two clock formats exist; anything else stored (or nothing) is the
  // 12-hour clock the app has always shown.
  it("constrains clockFormat to 12h/24h with 12h the legacy default", () => {
    expect(mergePreferences({}).clockFormat).toBe("12h");
    expect(mergePreferences({ clockFormat: "24h" }).clockFormat).toBe("24h");
    expect(mergePreferences({ clockFormat: "military" }).clockFormat).toBe("12h");
  });

  // The weekly/monthly chart windows only accept values the pickers offer
  // (0 = all periods); anything else falls back to the 5-period default.
  it("constrains the analytics chart period counts to the picker's ladder", () => {
    expect(mergePreferences({}).weeklyChartCount).toBe(5);
    expect(mergePreferences({}).monthlyChartCount).toBe(5);
    expect(mergePreferences({ weeklyChartCount: 12, monthlyChartCount: 0 })).toMatchObject({ weeklyChartCount: 12, monthlyChartCount: 0 });
    expect(mergePreferences({ weeklyChartCount: 7, monthlyChartCount: "9" })).toMatchObject({ weeklyChartCount: 5, monthlyChartCount: 5 });
    CHART_PERIOD_CHOICES.forEach((n) => expect(normalizeChartCount(n)).toBe(n));
  });

  it("backfills filters a stored preference set is missing", () => {
    const p = mergePreferences({ filters: { symbol: "BTC" } });
    expect(p.filters.status).toBe("");
    expect(p.filters.rrMin).toBe("");
  });

  it("defaults zoom to 1 and clamps a corrupt stored factor", () => {
    expect(mergePreferences({}).zoom).toBe(1);
    expect(mergePreferences({ zoom: "garbage" }).zoom).toBe(1);
    expect(mergePreferences({ zoom: 99 }).zoom).toBe(2);
    expect(mergePreferences({ zoom: 0.01 }).zoom).toBe(0.67);
  });

  it("only ever yields the two known density values", () => {
    expect(mergePreferences({}).density).toBe("comfortable");
    expect(mergePreferences({ density: "compact" }).density).toBe("compact");
    expect(mergePreferences({ density: "cozy" }).density).toBe("comfortable");
  });

  it("keeps hiddenColumns a clean string array whatever was stored", () => {
    expect(mergePreferences({}).hiddenColumns).toEqual([]);
    expect(mergePreferences({ hiddenColumns: ["grade", 7, null, "status"] }).hiddenColumns).toEqual(["grade", "status"]);
    expect(mergePreferences({ hiddenColumns: "grade" }).hiddenColumns).toEqual([]);
  });

  it("normalizes the accent override through normalizeAccent", () => {
    expect(mergePreferences({ accent: "#8B5CF6" }).accent).toBe("#8b5cf6");
    expect(mergePreferences({ accent: "red" }).accent).toBe("");
  });

  it("defaults the table sort and keeps a stored one", () => {
    expect(mergePreferences({}).tableSort).toEqual({ key: "entryDateTime", dir: "desc" });
    expect(mergePreferences({ tableSort: { key: "pnlAmount", dir: "asc" } }).tableSort).toEqual({ key: "pnlAmount", dir: "asc" });
  });

  it("repairs a corrupt stored table sort instead of wedging the table", () => {
    expect(mergePreferences({ tableSort: { key: 7, dir: "sideways" } }).tableSort).toEqual({ key: "entryDateTime", dir: "desc" });
    expect(mergePreferences({ tableSort: "garbage" }).tableSort).toEqual({ key: "entryDateTime", dir: "desc" });
  });

  it("only ever yields a known page size", () => {
    expect(mergePreferences({}).pageSize).toBe(50);
    expect(mergePreferences({ pageSize: 25 }).pageSize).toBe(25);
    expect(mergePreferences({ pageSize: 100 }).pageSize).toBe(100);
    expect(mergePreferences({ pageSize: 37 }).pageSize).toBe(50);
    expect(mergePreferences({ pageSize: "50" }).pageSize).toBe(50);
  });
});

describe("tradeWarnings", () => {
  it("stays silent on a coherent long trade", () => {
    expect(tradeWarnings({ direction: "Long", entryPrice: "100", stopLoss: "95", takeProfit: "110", entryDateTime: "2026-07-10T09:00", exitDateTime: "2026-07-10T11:00" })).toEqual([]);
  });

  it("flags a stop on the wrong side of entry, direction-aware", () => {
    expect(tradeWarnings({ direction: "Long", entryPrice: "100", stopLoss: "105" })[0]).toMatch(/above the entry on a Long/);
    expect(tradeWarnings({ direction: "Short", entryPrice: "100", stopLoss: "95" })[0]).toMatch(/below the entry on a Short/);
    // The same levels on the opposite direction are fine.
    expect(tradeWarnings({ direction: "Short", entryPrice: "100", stopLoss: "105" })).toEqual([]);
  });

  it("flags a take profit on the wrong side of entry, direction-aware", () => {
    expect(tradeWarnings({ direction: "Long", entryPrice: "100", takeProfit: "90" })[0]).toMatch(/below the entry on a Long/);
    expect(tradeWarnings({ direction: "Short", entryPrice: "100", takeProfit: "110" })[0]).toMatch(/above the entry on a Short/);
  });

  it("flags an exit time before the entry time", () => {
    expect(tradeWarnings({ entryDateTime: "2026-07-10T11:00", exitDateTime: "2026-07-10T09:00" })[0]).toMatch(/before the entry time/);
    expect(tradeWarnings({ entryDateTime: "2026-07-10T09:00", exitDateTime: "2026-07-10T09:00" })).toEqual([]);
  });

  it("says nothing about fields that are not filled in", () => {
    expect(tradeWarnings({ direction: "Long", entryPrice: "100" })).toEqual([]);
    expect(tradeWarnings({})).toEqual([]);
  });

  it("can carry several warnings at once", () => {
    const w = tradeWarnings({ direction: "Long", entryPrice: "100", stopLoss: "105", takeProfit: "90", entryDateTime: "2026-07-10T11:00", exitDateTime: "2026-07-10T09:00" });
    expect(w).toHaveLength(3);
  });
});

describe("normalizeAccent", () => {
  it("accepts only a six-digit hex colour, lowercased and trimmed", () => {
    expect(normalizeAccent(" #3E8FFF ")).toBe("#3e8fff");
    expect(normalizeAccent("#abc")).toBe("");
    expect(normalizeAccent("#12345g")).toBe("");
    expect(normalizeAccent("rgb(1,2,3)")).toBe("");
    expect(normalizeAccent(42)).toBe("");
    expect(normalizeAccent(undefined)).toBe("");
  });
});

describe("UI zoom ladder", () => {
  it("steps one level up or down from a level on the ladder", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
  });

  it("stops at the ends instead of walking off the ladder", () => {
    expect(stepZoom(2, 1)).toBe(2);
    expect(stepZoom(0.67, -1)).toBe(0.67);
  });

  it("snaps a factor between levels to the ladder before stepping", () => {
    // 1.3 is nearest 1.25; one step up lands on a real level, not 1.4.
    expect(stepZoom(1.3, 1)).toBe(1.5);
  });

  it("treats a non-numeric current factor as 100%", () => {
    expect(stepZoom(undefined, 1)).toBe(1.1);
    expect(clampZoom("junk")).toBe(1);
  });
});

describe("paletteFilter", () => {
  const items = [
    { key: "dash", haystack: "go to dashboard tab" },
    { key: "trades", haystack: "go to trades tab" },
    { key: "new", haystack: "new trade add log entry" },
    { key: "btc", haystack: "TJ-00001 BTCUSDT Long Price Action" },
    { key: "eth", haystack: "TJ-00002 ETHUSDT Short Scalping" },
  ];

  it("returns the first items in caller order for an empty query", () => {
    expect(paletteFilter("", items, 3).map((i) => i.key)).toEqual(["dash", "trades", "new"]);
    expect(paletteFilter(undefined, items, 2)).toHaveLength(2);
  });

  it("requires every token to match somewhere, in any order", () => {
    expect(paletteFilter("btc long", items).map((i) => i.key)).toEqual(["btc"]);
    expect(paletteFilter("long btc", items).map((i) => i.key)).toEqual(["btc"]);
    expect(paletteFilter("btc short", items)).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    expect(paletteFilter("ETHUSDT", items).map((i) => i.key)).toEqual(["eth"]);
  });

  it("ranks a word-start match above a mid-word one", () => {
    const list = [
      { key: "mid", haystack: "chart" },
      { key: "start", haystack: "art gallery" },
    ];
    expect(paletteFilter("art", list).map((i) => i.key)).toEqual(["start", "mid"]);
  });

  it("breaks ties by the caller's original order", () => {
    expect(paletteFilter("go to", items, 8).map((i) => i.key)).toEqual(["dash", "trades"]);
  });

  it("respects the limit and tolerates junk items", () => {
    expect(paletteFilter("t", items, 2)).toHaveLength(2);
    expect(paletteFilter("x", [{ haystack: null }, {}, null])).toHaveLength(0);
  });
});

describe("storage sharding", () => {
  it("always lands inside the shard range", () => {
    for (let i = 1; i < 500; i++) {
      const n = shardOf(`TJ-${String(i).padStart(5, "0")}`);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(SHARD_COUNT);
    }
  });

  it("is deterministic — a trade must always hash to the same shard, or its record is lost", () => {
    expect(shardOf("TJ-00042")).toBe(shardOf("TJ-00042"));
    expect(djb2("TJ-00042")).toBe(djb2("TJ-00042"));
  });

  it("spreads a journal across many shards rather than piling into one", () => {
    const used = new Set();
    for (let i = 1; i <= 200; i++) used.add(shardOf(`TJ-${String(i).padStart(5, "0")}`));
    expect(used.size).toBeGreaterThan(SHARD_COUNT / 2);
  });

  it("names shard keys under the prefix the loader lists by", () => {
    expect(shardKey(3)).toBe("brij-tj-shard-3");
  });
});

describe("nextTradeId", () => {
  it("starts a fresh journal at 1", () => {
    expect(nextTradeId([])).toBe("TJ-00001");
  });

  it("continues past the highest id, not the trade count", () => {
    expect(nextTradeId([{ id: "TJ-00007" }, { id: "TJ-00003" }])).toBe("TJ-00008");
  });

  it("ignores ids it did not mint", () => {
    expect(nextTradeId([{ id: "imported-abc" }, { id: "" }])).toBe("TJ-00001");
  });

  /* The high-water mark. Without it, deleting a trade frees its number: the
     Undo toast still holds the record, so the next trade is minted with the
     same id and Undo restores a duplicate. Two trades sharing an id share a
     shard entry, a React key and a screenshot key, and editing one rewrites
     both. */
  it("does not reissue the id of a trade that was just deleted", () => {
    const afterDelete = [{ id: "TJ-00001" }, { id: "TJ-00002" }, { id: "TJ-00003" }];
    // TJ-00004 was the deleted trade — its number is spent even though the
    // journal no longer lists it.
    expect(nextTradeId(afterDelete, 4)).toBe("TJ-00005");
  });

  it("never issues an id below one already in the journal", () => {
    // A counter that somehow lags the journal must not win.
    expect(nextTradeId([{ id: "TJ-00009" }], 2)).toBe("TJ-00010");
  });

  it("treats a missing counter as a fresh journal", () => {
    expect(nextTradeId([])).toBe("TJ-00001");
    expect(nextTradeId([], 0)).toBe("TJ-00001");
  });
});

describe("tradeSeq", () => {
  it("reads the sequence number out of a minted id", () => {
    expect(tradeSeq("TJ-00042")).toBe(42);
  });

  it("scores anything it did not mint as zero, so it can never raise the mark", () => {
    expect(tradeSeq("imported-abc")).toBe(0);
    expect(tradeSeq("")).toBe(0);
    expect(tradeSeq(undefined)).toBe(0);
  });
});

describe("parseCSV", () => {
  it("reads quoted fields containing commas", () => {
    const rows = parseCSV('Symbol,Notes\r\nBTCUSD,"hello, world"');
    expect(rows).toEqual([{ Symbol: "BTCUSD", Notes: "hello, world" }]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCSV('Symbol,Notes\r\nBTCUSD,"say ""hi"""')[0].Notes).toBe('say "hi"');
  });

  it("reads quoted newlines as part of the field", () => {
    expect(parseCSV('Symbol,Notes\r\nBTCUSD,"line1\nline2"')[0].Notes).toBe("line1\nline2");
  });

  it("skips blank lines", () => {
    expect(parseCSV("Symbol\r\nBTCUSD\r\n\r\nETHUSD")).toHaveLength(2);
  });

  it("returns nothing for empty input", () => {
    expect(parseCSV("")).toEqual([]);
  });
});

describe("csvCell", () => {
  it("quotes only what needs quoting", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("writes an absent value as empty, not as the string null", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("CSV import", () => {
  const mt4Row = {
    Symbol: "EURUSD", Type: "sell", "Open Price": "1.1000", "Close Price": "1.0900",
    "S/L": "1.1050", "T/P": "1.0800", Size: "1",
    Commission: "-2", Swap: "-1",
    "Open Time": "2026.07.10 09:00", "Close Time": "2026.07.10 11:00",
  };

  it("maps an MT4-style statement row onto a trade", () => {
    const [t] = rowsToTrades([mt4Row], {});
    expect(t.symbol).toBe("EURUSD");
    expect(t.direction).toBe("Short");
    expect(t.entryPrice).toBe("1.1000");
    expect(t.exitPrice).toBe("1.0900");
    expect(t.stopLoss).toBe("1.1050");
    expect(t.positionSize).toBe("1");
    expect(t.status).toBe("Closed");
  });

  it("keeps commission and swap apart, and totals them into fees", () => {
    const [t] = rowsToTrades([mt4Row], {});
    expect(t.commission).toBe("-2");
    expect(t.swap).toBe("-1");
    expect(t.fees).toBe("-3");
  });

  it("normalizes MT4's dotted dates into the form's local input format", () => {
    const [t] = rowsToTrades([mt4Row], {});
    expect(t.entryDateTime).toBe("2026-07-10T09:00");
    expect(t.exitDateTime).toBe("2026-07-10T11:00");
  });

  it("reads every spelling of a sell", () => {
    ["sell", "SELL", "Short", "1"].forEach((type) => {
      expect(rowsToTrades([{ Symbol: "X", Price: "1", Type: type }], {})[0].direction).toBe("Short");
    });
  });

  it("treats anything else as a buy", () => {
    ["buy", "Long", ""].forEach((type) => {
      expect(rowsToTrades([{ Symbol: "X", Price: "1", Type: type }], {})[0].direction).toBe("Long");
    });
  });

  it("opens a row that never closed", () => {
    expect(rowsToTrades([{ Symbol: "X", Price: "1" }], {})[0].status).toBe("Open");
  });

  it("drops rows with no symbol or no entry price rather than importing junk", () => {
    expect(rowsToTrades([{ Symbol: "", Price: "1" }, { Symbol: "X", Price: "" }], {})).toHaveLength(0);
  });

  it("refuses a grade or market it does not offer, falling back to the default", () => {
    const [t] = rowsToTrades([{ Symbol: "X", Price: "1", Grade: "Z", Market: "Tulips" }], {});
    expect(t.grade).toBe("B");
    expect(t.marketType).toBe("Crypto");
  });

  it("keeps a grade and market it does offer, case-insensitively", () => {
    const [t] = rowsToTrades([{ Symbol: "X", Price: "1", Grade: "a+", Market: "forex" }], {});
    expect(t.grade).toBe("A+");
    expect(t.marketType).toBe("Forex");
  });

  it("carries the last-used defaults onto an import that does not name them", () => {
    const [t] = rowsToTrades([{ Symbol: "X", Price: "1" }], { strategy: "ICT", riskAmount: "50" });
    expect(t.strategy).toBe("ICT");
    expect(t.riskAmount).toBe("50");
  });

  it("rejects an unparseable date instead of storing Invalid Date", () => {
    expect(normalizeCsvDate("not a date")).toBe("");
    expect(normalizeCsvDate("")).toBe("");
  });
});

describe("partitionDuplicateImports", () => {
  const existing = [
    { symbol: "EURUSD", entryDateTime: "2026-07-10T09:00" },
    { symbol: "BTCUSDT", entryDateTime: "2026-07-11T14:30" },
  ];

  it("flags an incoming row matching an existing trade's symbol and entry time", () => {
    const { fresh, duplicates } = partitionDuplicateImports(existing, [
      { symbol: "EURUSD", entryDateTime: "2026-07-10T09:00" },
      { symbol: "EURUSD", entryDateTime: "2026-07-10T10:00" },
    ]);
    expect(duplicates).toHaveLength(1);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].entryDateTime).toBe("2026-07-10T10:00");
  });

  it("matches symbols case-insensitively and ignores surrounding whitespace", () => {
    const { duplicates } = partitionDuplicateImports(existing, [
      { symbol: " eurusd ", entryDateTime: "2026-07-10T09:00" },
    ]);
    expect(duplicates).toHaveLength(1);
  });

  it("never calls a dateless row a duplicate — missing halves match nothing", () => {
    const noDate = [{ symbol: "EURUSD", entryDateTime: "" }];
    const { fresh, duplicates } = partitionDuplicateImports(
      [...existing, { symbol: "EURUSD", entryDateTime: "" }],
      noDate
    );
    expect(duplicates).toHaveLength(0);
    expect(fresh).toHaveLength(1);
  });

  it("keeps every incoming row — partitioned, not filtered", () => {
    const incoming = [
      { symbol: "EURUSD", entryDateTime: "2026-07-10T09:00" },
      { symbol: "XAUUSD", entryDateTime: "2026-07-12T08:00" },
    ];
    const { fresh, duplicates } = partitionDuplicateImports(existing, incoming);
    expect(fresh.length + duplicates.length).toBe(incoming.length);
  });

  it("treats an empty journal as all-fresh", () => {
    const { fresh, duplicates } = partitionDuplicateImports([], [{ symbol: "X", entryDateTime: "2026-01-01T00:00" }]);
    expect(fresh).toHaveLength(1);
    expect(duplicates).toHaveLength(0);
  });
});

describe("CSV export", () => {
  it("writes a header and one line per trade", () => {
    const csv = tradesToCSV([computeTrade(baseTrade())]);
    const [header, row] = csv.split("\r\n");
    expect(header).toContain("Trade ID");
    expect(header).toContain("P&L Amount");
    expect(row).toContain("BTCUSD");
  });

  it("escapes a note containing a comma so the columns still line up", () => {
    const csv = tradesToCSV([computeTrade(baseTrade({ notes: "scaled in, then out" }))]);
    expect(csv).toContain('"scaled in, then out"');
    expect(parseCSV(csv)[0].Notes).toBe("scaled in, then out");
  });

  it("round-trips a split-fee trade through export and back", () => {
    const exported = tradesToCSV([computeTrade(baseTrade({ commission: "3", swap: "1" }))]);
    const [reimported] = rowsToTrades(parseCSV(exported), {});
    expect(reimported.symbol).toBe("BTCUSD");
    expect(reimported.commission).toBe("3");
    expect(reimported.swap).toBe("1");
    expect(reimported.fees).toBe("4");
  });

  // A pre-split trade exports as Commission="", Swap="", Fees=5, because
  // _commission is null for trades with no split. findCsvField() must skip the
  // present-but-empty "Commission" column and fall through to "Fees" — matching
  // the empty column zeroed the cost on re-import (was KNOWN_ISSUES #1).
  it("round-trips a pre-split trade's fees through export and back", () => {
    const exported = tradesToCSV([computeTrade(baseTrade({ fees: "5" }))]);
    const [reimported] = rowsToTrades(parseCSV(exported), {});
    expect(reimported.fees).toBe("5");
  });
});

describe("escapeHtml", () => {
  it("neutralizes markup in free text bound for a report", () => {
    expect(escapeHtml('<b>&"\'')).toBe("&lt;b&gt;&amp;&quot;&#39;");
  });

  it("renders an absent value as empty", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("durationLabel", () => {
  it("labels minutes, hours and days", () => {
    expect(durationLabel("2026-07-16T09:00", "2026-07-16T09:45")).toBe("45m");
    expect(durationLabel("2026-07-16T09:00", "2026-07-16T11:30")).toBe("2h 30m");
    expect(durationLabel("2026-07-16T09:00", "2026-07-18T15:00")).toBe("2d 6h");
  });

  it("refuses a negative or unknown span", () => {
    expect(durationLabel("2026-07-16T11:00", "2026-07-16T09:00")).toBe("—");
    expect(durationLabel("", "2026-07-16T09:00")).toBe("—");
    expect(durationLabel("2026-07-16T09:00", "")).toBe("—");
  });
});

describe("date bucketing", () => {
  it("keys the ISO week", () => {
    expect(isoWeekKey("2026-07-16T10:00:00")).toBe("2026-W29");
  });

  it("puts a Sunday and the following Monday in different ISO weeks", () => {
    expect(isoWeekKey("2026-07-12T10:00:00")).not.toBe(isoWeekKey("2026-07-13T10:00:00"));
  });

  it("keys the month and the week of the month", () => {
    expect(monthKey("2026-07-16T10:00:00")).toBe("2026-07");
    expect(weekOfMonthKey("2026-07-16T10:00:00")).toBe("2026-07-W3");
  });

  it("rejects an unparseable date", () => {
    expect(monthKey("nonsense")).toBeNull();
    expect(isoWeekKey("nonsense")).toBeNull();
    expect(isoDate("nonsense")).toBeNull();
  });

  it("starts the week on Sunday", () => {
    expect(startOfWeek(new Date(2026, 6, 16)).getDay()).toBe(0);   // Thu -> Sun
    expect(startOfWeek(new Date(2026, 6, 16)).getDate()).toBe(12);
  });

  it("formats a Date for the form's datetime input in local time", () => {
    expect(toLocalInputValue(new Date(2026, 6, 16, 2, 5))).toBe("2026-07-16T02:05");
  });
});

/* ----------------------------------------------------------------------------
   TIMEZONE. isoDate() is the app's day key — the calendar grid, the day filter,
   the dashboard's "today" and every date preset are built on it. Every caller
   hands it a Date built from local parts, so it must answer with the local day.
   It used to return a UTC day (`toISOString()`), which agreed at UTC+0 and
   nowhere else: at IST a trade before 05:30 filed under the previous day, and
   a calendar cell labelled with a local date was keyed with a UTC one.

   These run under TZ=Asia/Kolkata (see TESTING.md). That pin is what makes them
   meaningful — on a UTC machine every one passes against the old broken code.
---------------------------------------------------------------------------- */
describe("isoDate — local day keys", () => {
  it("agrees with the local day for an afternoon trade", () => {
    expect(isoDate("2026-07-16T14:00:00")).toBe("2026-07-16");
  });

  // 02:00 IST is still the 16th to the trader who took the trade, though it is
  // 20:30 UTC on the 15th. byDay is keyed with this, so a UTC answer showed the
  // trade on the wrong calendar day.
  it("agrees with the local day for an early-morning trade", () => {
    expect(isoDate("2026-07-16T02:00:00")).toBe("2026-07-16");
  });

  // This is the calendar cell key. The grid renders dayCell(isoDate(d),
  // d.getDate()) — the cell is LABELLED from d.getDate() and KEYED from
  // isoDate, so the two must name the same day or every cell shows the wrong
  // trades.
  it("keys a calendar cell with the day it is labelled with", () => {
    expect(isoDate(new Date(2026, 6, 16))).toBe("2026-07-16");
  });

  // Local midnight is the far side of the meridian in UTC. This is the exact
  // case that made the weekly grid disagree with the monthly one.
  it("keys local midnight to that same local day", () => {
    expect(isoDate(new Date(2026, 6, 16, 0, 0, 0))).toBe("2026-07-16");
    expect(isoDate(new Date(2026, 6, 16, 23, 59, 59))).toBe("2026-07-16");
  });
});

describe("zonedNow — journal-timezone clock", () => {
  // The suite runs at Asia/Kolkata (UTC+5:30); each expectation below reads
  // another zone's wall clock from the same instant. Only "now" flows through
  // this — stored trade times are naive strings and never pass through here.
  it("reads New York's wall clock in winter (EST, UTC-5)", () => {
    const d = zonedNow("America/New_York", new Date("2026-01-15T12:00:00Z"));
    expect(toLocalInputValue(d)).toBe("2026-01-15T07:00");
  });

  it("follows DST — the same zone reads UTC-4 in summer", () => {
    const d = zonedNow("America/New_York", new Date("2026-07-15T12:00:00Z"));
    expect(toLocalInputValue(d)).toBe("2026-07-15T08:00");
  });

  // The point of the setting: at this instant the machine (IST) is already on
  // the 16th while New York is still on the 15th. "Today", the presets and the
  // calendar highlight must land on the journal zone's day, not the machine's.
  it("gives a different 'today' than the machine when zones straddle midnight", () => {
    const at = new Date("2026-01-15T20:00:00Z");   // 01:30 on the 16th in IST
    expect(isoDate(at)).toBe("2026-01-16");
    expect(isoDate(zonedNow("America/New_York", at))).toBe("2026-01-15");
  });

  it("feeds dateRangeForPreset the journal zone's day", () => {
    const at = new Date("2026-01-15T20:00:00Z");
    const r = dateRangeForPreset("today", zonedNow("America/New_York", at));
    expect(r).toMatchObject({ from: "2026-01-15", to: "2026-01-15" });
  });

  it("returns the instant unchanged for the machine zone sentinel \"\"", () => {
    const at = new Date("2026-07-15T12:00:00Z");
    expect(zonedNow("", at).getTime()).toBe(at.getTime());
  });

  it("falls back to the machine zone on an unknown zone id", () => {
    const at = new Date("2026-07-15T12:00:00Z");
    expect(zonedNow("Not/AZone", at).getTime()).toBe(at.getTime());
  });

  it("agrees with the machine's own wall clock for the machine's zone", () => {
    const at = new Date("2026-07-15T12:00:00Z");
    expect(toLocalInputValue(zonedNow("Asia/Kolkata", at))).toBe(toLocalInputValue(at));
  });
});

describe("tzOffsetLabel", () => {
  it("labels a zone with its GMT offset, tracking DST", () => {
    expect(tzOffsetLabel("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe("GMT-5");
    expect(tzOffsetLabel("America/New_York", new Date("2026-07-15T12:00:00Z"))).toBe("GMT-4");
  });

  it("carries half-hour offsets", () => {
    expect(tzOffsetLabel("Asia/Kolkata", new Date("2026-07-15T12:00:00Z"))).toBe("GMT+5:30");
  });

  it("returns empty for an unknown zone", () => {
    expect(tzOffsetLabel("Not/AZone")).toBe("");
  });
});

describe("isValidTimeZone / normalizeTimezone", () => {
  it("accepts a real IANA id and rejects junk", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });

  it("normalizes anything invalid to the machine sentinel \"\"", () => {
    expect(normalizeTimezone("Europe/London")).toBe("Europe/London");
    expect(normalizeTimezone("Mars/Olympus_Mons")).toBe("");
    expect(normalizeTimezone(42)).toBe("");
  });
});

describe("daily journal export", () => {
  const notes = {
    "2026-07-15": "Choppy morning, stood aside.",
    "2026-07-17": "Clean trend day.\nTook both setups.",
    "2026-07-16": "   ",              // blank — never exported
    "junk-key": "not a day note",
  };
  const entries = () => journalEntries(notes);

  it("orders entries newest first and drops blanks and non-day keys", () => {
    expect(entries().map(([d]) => d)).toEqual(["2026-07-17", "2026-07-15"]);
  });

  it("renders markdown with a day's trading result on the heading", () => {
    const md = journalToMarkdown(entries(), { "2026-07-17": { pnl: 150, count: 2 }, "2026-07-15": { pnl: -25.5, count: 1 } });
    expect(md).toContain("## 2026-07-17 — 2 trades, P&L +$150.00");
    expect(md).toContain("## 2026-07-15 — 1 trade, P&L -$25.50");
    expect(md.indexOf("2026-07-17")).toBeLessThan(md.indexOf("2026-07-15"));
    expect(md).not.toContain("junk-key");
  });

  it("leaves the heading bare for a day with no trades", () => {
    expect(journalToMarkdown(journalEntries({ "2026-07-15": "note" }))).toContain("## 2026-07-15\n");
  });

  // A multi-line note must survive the CSV round trip — same quoting rules
  // as the trade export, so parseCSV reads it back intact.
  it("round-trips a multi-line note through CSV quoting", () => {
    const csv = journalToCSV(entries());
    const rows = parseCSV(csv);
    expect(rows[0]).toEqual({ Date: "2026-07-17", Note: "Clean trend day.\nTook both setups." });
    expect(rows).toHaveLength(2);
  });

  it("filters by inclusive day range and case-insensitive note text", () => {
    expect(filterJournalEntries(entries(), { from: "2026-07-16" }).map(([d]) => d)).toEqual(["2026-07-17"]);
    expect(filterJournalEntries(entries(), { to: "2026-07-15" }).map(([d]) => d)).toEqual(["2026-07-15"]);
    expect(filterJournalEntries(entries(), { from: "2026-07-15", to: "2026-07-17" })).toHaveLength(2);
    expect(filterJournalEntries(entries(), { search: "CHOPPY" }).map(([d]) => d)).toEqual(["2026-07-15"]);
    expect(filterJournalEntries(entries(), {})).toHaveLength(2);
  });

  // The filter feeds the exporters directly — a filtered export must hold
  // exactly the filtered entries, nothing re-derived from the full map.
  it("exports only the filtered entries", () => {
    const filtered = filterJournalEntries(entries(), { search: "trend" });
    const md = journalToMarkdown(filtered);
    expect(md).toContain("2026-07-17");
    expect(md).not.toContain("2026-07-15");
  });

  it("escapes note free text in the HTML export but keeps the stats heading", () => {
    const html = journalToHtml(
      journalEntries({ "2026-07-17": "P&L <b>bold</b> day.\nSecond line." }),
      { "2026-07-17": { pnl: 150, count: 2 } },
      { generatedLabel: "Generated today" },
    );
    expect(html).toContain("<h2>2026-07-17 — 2 trades, P&amp;L +$150.00</h2>");
    expect(html).toContain("P&amp;L &lt;b&gt;bold&lt;/b&gt; day.<br/>Second line.");
    expect(html).toContain("Generated today");
    expect(html).not.toContain("<b>bold</b>");
  });

  it("adds Office namespaces only for the Word variant", () => {
    const word = journalToHtml(entries(), {}, { forWord: true });
    const pdf = journalToHtml(entries(), {}, { forWord: false });
    expect(word).toContain("schemas-microsoft-com:office:word");
    expect(word).not.toContain("@page");
    expect(pdf).toContain("@page{size:A4");
    expect(pdf).not.toContain("schemas-microsoft-com");
  });
});

describe("dateInRange", () => {
  it("includes a date inside the range and excludes one outside", () => {
    expect(dateInRange("2026-07-16T14:00:00", "2026-07-01", "2026-07-31")).toBe(true);
    expect(dateInRange("2026-08-01T14:00:00", "2026-07-01", "2026-07-31")).toBe(false);
  });

  it("treats an open-ended range as unbounded on that side", () => {
    expect(dateInRange("2026-07-16T14:00:00", "", "")).toBe(true);
    expect(dateInRange("2026-07-16T14:00:00", "2026-07-01", "")).toBe(true);
  });

  it("excludes an unparseable date", () => {
    expect(dateInRange("nonsense", "2026-07-01", "2026-07-31")).toBe(false);
  });

  // The range bounds come from a date input, which is local. A trade at 02:00
  // on the 16th must fall inside a range that explicitly covers the 16th.
  it("includes an early-morning trade in a range covering that local day", () => {
    expect(dateInRange("2026-07-16T02:00:00", "2026-07-16", "2026-07-16")).toBe(true);
  });
});

describe("dateRangeForPreset", () => {
  const cursor = new Date(2026, 6, 16, 12, 0);   // Thu 16 Jul 2026, midday local

  it("bounds the year without touching the day keys", () => {
    const r = dateRangeForPreset("year", cursor);
    expect(r).toMatchObject({ from: "2026-01-01", to: "2026-12-31", label: "This Year" });
  });

  it("passes a custom range straight through", () => {
    expect(dateRangeForPreset("custom", cursor, "2026-01-01", "2026-03-01"))
      .toMatchObject({ from: "2026-01-01", to: "2026-03-01", label: "Custom Range" });
  });

  it("leaves an unknown preset unbounded", () => {
    expect(dateRangeForPreset("", cursor)).toMatchObject({ from: "", to: "", label: "All Dates" });
  });

  it("labels the presets", () => {
    expect(dateRangeForPreset("today", cursor).label).toBe("Today");
    expect(dateRangeForPreset("month", cursor).label).toBe("This Month");
  });

  // "today" is derived from local now. Before 05:30 IST a UTC day key selected
  // yesterday outright.
  it("bounds today to the local day", () => {
    const early = new Date(2026, 6, 16, 2, 0);
    expect(dateRangeForPreset("today", early)).toMatchObject({ from: "2026-07-16", to: "2026-07-16" });
  });

  // The month starts at local midnight on the 1st, which is 18:30 UTC on the
  // last day of the previous month — so a UTC key opened "This Month" a day
  // early and pulled in trades from June.
  it("bounds the month to local month boundaries", () => {
    expect(dateRangeForPreset("month", cursor)).toMatchObject({ from: "2026-07-01", to: "2026-07-31" });
  });

  // Same, one week wide.
  it("bounds the week to local week boundaries", () => {
    expect(dateRangeForPreset("week", cursor)).toMatchObject({ from: "2026-07-12", to: "2026-07-18" });
  });
});

describe("tradeToForm", () => {
  const accounts = [{ id: "acct-a", name: "A" }, { id: "acct-b", name: "B" }];

  it("moves a pre-split trade's fees under commission so editing does not zero the cost", () => {
    const f = tradeToForm(baseTrade({ fees: "5" }), accounts);
    expect(f.commission).toBe("5");
    expect(f.swap).toBe("");
  });

  it("leaves a trade that already uses the split alone", () => {
    const f = tradeToForm(baseTrade({ fees: "4", commission: "3", swap: "1" }), accounts);
    expect(f.commission).toBe("3");
    expect(f.swap).toBe("1");
  });

  it("gives restored legs the stable ids the editor needs", () => {
    const f = tradeToForm(baseTrade({ entries: [{ price: "100", qty: "1" }] }), accounts);
    expect(f.entries[0].id).toBeTruthy();
  });

  it("heals a trade pointing at an account that no longer exists", () => {
    const f = tradeToForm(baseTrade({ accountId: "acct-deleted" }), accounts);
    expect(f.accountId).toBe("acct-a");
  });

  it("keeps an account that does exist", () => {
    expect(tradeToForm(baseTrade({ accountId: "acct-b" }), accounts).accountId).toBe("acct-b");
  });

  it("drops derived fields on the way into the form", () => {
    const f = tradeToForm(computeTrade(baseTrade()), accounts);
    expect(f).not.toHaveProperty("pnlAmount");
    expect(f).not.toHaveProperty("_entry");
  });
});

describe("withDerivedFills", () => {
  it("mirrors the legs' aggregate onto the flat fields older code reads", () => {
    const f = withDerivedFills({
      ...emptyTrade(), stopLoss: "90",
      entries: [{ price: "100", qty: "1" }, { price: "90", qty: "1" }],
    });
    expect(f.entryPrice).toBe("95");
    expect(f.positionSize).toBe("2");
  });

  it("re-prices risk from the real size, so scaling in re-risks the trade", () => {
    const f = withDerivedFills({
      ...emptyTrade(), stopLoss: "90", riskAmount: "1",
      entries: [{ price: "100", qty: "1" }, { price: "90", qty: "1" }],   // avg 95, qty 2
    });
    expect(f.riskAmount).toBe("10");    // 2 * |95 - 90|
  });

  it("takes the exit price and close time from the exit legs", () => {
    const f = withDerivedFills({
      ...emptyTrade(),
      exits: [{ price: "110", qty: "1", datetime: "2026-07-16T11:00" }],
    });
    expect(f.exitPrice).toBe("110");
    expect(f.exitDateTime).toBe("2026-07-16T11:00");
  });

  it("leaves an unscaled form untouched", () => {
    const before = { ...emptyTrade(), entryPrice: "100", positionSize: "2" };
    expect(withDerivedFills(before).entryPrice).toBe("100");
  });
});

describe("formSignature", () => {
  it("sees a real edit", () => {
    const a = emptyTrade();
    expect(formSignature(a)).not.toBe(formSignature({ ...a, entryPrice: "100" }));
  });

  it("reduces screenshots to identity, so megabytes of base64 are not re-serialised to answer 'dirty?'", () => {
    const a = { ...emptyTrade(), screenshots: [{ id: "S1", stage: "Exit", data: "AAAA" }] };
    const b = { ...emptyTrade(), screenshots: [{ id: "S1", stage: "Exit", data: "BBBB" }] };
    expect(formSignature(a)).toBe(formSignature(b));
    expect(formSignature(a)).not.toContain("AAAA");
  });

  it("sees a screenshot swapped for a different one", () => {
    const a = { ...emptyTrade(), screenshots: [{ id: "S1", stage: "Exit" }] };
    const b = { ...emptyTrade(), screenshots: [{ id: "S2", stage: "Exit" }] };
    expect(formSignature(a)).not.toBe(formSignature(b));
  });
});
