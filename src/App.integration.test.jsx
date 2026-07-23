// @vitest-environment jsdom
/**
 * Integration coverage for the boot -> render -> save loop described in
 * ARCHITECTURE.md, which no other suite exercises: App.test.jsx renders
 * individual panels in isolation with storage out of the picture entirely,
 * and lib/trade.test.js is pure/storage-free by design. This mocks
 * ./lib/storage with an in-memory store and drives the real default-exported
 * App through it, pinning the shard-diffing, the meta/trade save split and
 * the loadError fail-safe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// These are the only tests that mount the whole App — boot, storage reads,
// effects and all — and each one waits on that loop settling. Under
// `--coverage` the v8 instrumentation plus the other suites running alongside
// pushes a boot past vitest's 5s default and the file fails as a batch while
// passing on its own. The work is real, not a hang; this gives it room.
vi.setConfig({ testTimeout: 20000 });

// Charts are Recharts-backed and reached via React.lazy; nothing here is
// about charting, so stub the module rather than let Suspense actually
// resolve real chart components (and Recharts) inside jsdom.
vi.mock("./Charts", () => {
  const Stub = () => null;
  return Object.fromEntries([
    "EquityCurveChart", "DailyPnLChart", "MonthlyChart", "WinLossPie", "LongShortChart",
    "RRDistributionChart", "HourOfDayChart", "DayOfWeekChart", "DurationHistogramChart",
    "AssetPerformanceChart", "StrategyPerformanceChart", "PerformanceBarChart", "MaeMfeChart",
  ].map((name) => [name, Stub]));
});

// An in-memory stand-in for lib/storage's get/set/delete/list contract, kept
// in a vi.hoisted() block so it exists before the vi.mock factory below runs
// (mocks are hoisted above regular imports, so a plain top-level `const`
// would still be in its temporal dead zone when the factory executes).
const { store, mockGet, mockSet, mockDelete, mockList } = vi.hoisted(() => {
  const store = new Map();
  return {
    store,
    mockGet: vi.fn((key) => Promise.resolve(store.has(key) ? { key, value: store.get(key), shared: false } : null)),
    mockSet: vi.fn((key, value) => { store.set(key, value); return Promise.resolve({ key, value, shared: false }); }),
    mockDelete: vi.fn((key) => { store.delete(key); return Promise.resolve({ key, deleted: true, shared: false }); }),
    mockList: vi.fn((prefix = "") => Promise.resolve({ keys: [...store.keys()].filter((k) => !prefix || k.startsWith(prefix)), prefix, shared: false })),
  };
});
vi.mock("./lib/storage", () => ({
  storage: { get: mockGet, set: mockSet, delete: mockDelete, list: mockList },
}));

import App from "./App";
import { META_KEY, SHARD_PREFIX, DEFAULT_ACCOUNT_ID, DEFAULT_SETTINGS, DEFAULT_PREFERENCES, shardKey, shardOf } from "./lib/trade";

// Mirrors trade.test.js's baseTrade: a closed long, in at 100 out at 110.
const baseTrade = (over = {}) => ({
  id: "TJ-00001", accountId: DEFAULT_ACCOUNT_ID, symbol: "BTCUSD", marketType: "Crypto",
  direction: "Long", status: "Closed",
  entryPrice: "100", stopLoss: "95", takeProfit: "120", exitPrice: "110",
  positionSize: "2", fees: "", commission: "", swap: "", riskAmount: "10",
  entryDateTime: "2026-07-16T09:00", exitDateTime: "2026-07-16T11:00",
  entries: [], exits: [], tags: [], checklist: {}, notes: "", grade: "B", strategy: "ICT",
  ...over,
});

const seedShard = (trade) => store.set(shardKey(shardOf(trade.id)), JSON.stringify([trade]));
const seedMeta = (over = {}) => store.set(META_KEY, JSON.stringify({
  settings: DEFAULT_SETTINGS, strategies: [], lastDefaults: {}, theme: "dark", preferences: DEFAULT_PREFERENCES, tradeSeq: 1, ...over,
}));

// Both save effects debounce 500ms. Real timers keep this in step with the
// production 500ms rather than faking React's scheduler as well.
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const setCallsByPrefix = (prefix) => mockSet.mock.calls.filter(([key]) => key.startsWith(prefix));

beforeEach(() => {
  store.clear();
  mockGet.mockClear();
  mockSet.mockClear();
  mockDelete.mockClear();
  mockList.mockClear();
  mockList.mockImplementation((prefix = "") => Promise.resolve({ keys: [...store.keys()].filter((k) => !prefix || k.startsWith(prefix)), prefix, shared: false }));
});
afterEach(cleanup);

describe("App boot", () => {
  it("reads meta and shards from storage and renders what it finds", async () => {
    seedShard(baseTrade());
    seedMeta({ strategies: ["MyUniqueStrategy"] });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Trades" }));
    expect(await screen.findByText("BTCUSD")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Playbook" }));
    expect(await screen.findByText("MyUniqueStrategy")).toBeTruthy();
  });
});

describe("Trade save — shard diffing", () => {
  it("editing one trade writes only its shard, not all 24", async () => {
    seedShard(baseTrade());
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Trades" }));
    await screen.findByText("BTCUSD");

    // Boot flips `loaded` false -> true, which is itself a dependency of both
    // save effects, so an automatic (no-op for shards, since nothing on disk
    // actually changed) save round happens once at startup. Let it settle and
    // clear the mock history so the assertions below are about the edit only.
    await settle();
    mockSet.mockClear();

    await user.click(screen.getByRole("button", { name: /edit grade for tj-00001/i }));
    await user.selectOptions(screen.getByRole("combobox", { name: /grade for tj-00001/i }), "A");
    await settle();

    const shardWrites = setCallsByPrefix(SHARD_PREFIX);
    expect(shardWrites).toHaveLength(1);
    expect(shardWrites[0][0]).toBe(shardKey(shardOf("TJ-00001")));
    // Grade alone doesn't touch settings/strategies/preferences/theme/tradeSeq,
    // so the separate meta effect must not have fired for this edit.
    expect(setCallsByPrefix(META_KEY)).toHaveLength(0);

    const saved = JSON.parse(store.get(shardKey(shardOf("TJ-00001"))));
    expect(saved).toHaveLength(1);
    expect(saved[0].grade).toBe("A");
  });
});

describe("Meta vs. trade saves — separate effects", () => {
  it("a preference change (tab switch) saves meta without rewriting any trade shard", async () => {
    seedShard(baseTrade());
    render(<App />);
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Trades" });
    await settle();
    mockSet.mockClear();

    await user.click(screen.getByRole("button", { name: "Analytics" }));
    await settle();

    expect(setCallsByPrefix(META_KEY).length).toBeGreaterThan(0);
    expect(setCallsByPrefix(SHARD_PREFIX)).toHaveLength(0);
  });
});

describe("loadError — a failed read disables persistence", () => {
  it("shows the fail-safe screen and never overwrites the shards already on disk", async () => {
    seedShard(baseTrade());
    const before = store.get(shardKey(shardOf("TJ-00001")));
    mockList.mockImplementationOnce(() => Promise.reject(new Error("disk read failed")));

    render(<App />);
    expect(await screen.findByText(/your trades could not be loaded/i)).toBeTruthy();
    expect(screen.getByText(/disk read failed/i)).toBeTruthy();

    await settle();
    expect(mockSet).not.toHaveBeenCalled();
    expect(store.get(shardKey(shardOf("TJ-00001")))).toBe(before);
  });
});
