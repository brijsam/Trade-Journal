/**
 * Every pure, non-visual rule the journal runs on: the trade maths, aggregate
 * stats, date bucketing, storage sharding, account/settings normalization and
 * CSV import/export.
 *
 * Split out of App.jsx for the same reason ./format was — App.jsx is the React
 * shell, and none of this needs React, the DOM or storage to run. Keeping it
 * here means it can be tested directly (see trade.test.js) and imported without
 * dragging the app in. Anything that touches window, document or storage stays
 * in App.jsx.
 *
 * This file must not import App.jsx. That would be circular and would defeat the
 * chart code-splitting, exactly as documented in ./format.
 */
import { num, round } from "./format";

/* ============================================================================
   DOMAIN TYPES
   Deliberately not exhaustive-strict everywhere: several functions below exist
   specifically to coerce "whatever's on disk" (a hand-edited backup, a journal
   written by an older build, a CSV from someone else's broker) into one of
   these shapes. Those boundary functions take loose/unknown input on purpose —
   that IS their job — and return one of the types below, which is what the
   rest of the app (and the rest of this file) can then rely on.
============================================================================ */
export type Direction = "Long" | "Short";
export type TradeStatus = "Open" | "Closed";
export type TradeResult = "win" | "loss" | "breakeven";
export type TransactionType = "deposit" | "withdrawal";

export interface FillLeg {
  id: string;
  price: string;
  qty: string;
  datetime: string;
}

// String-valued price/size/date fields throughout — what an <input> hands
// back, and the shape a trade takes on disk, in the form, and out of a CSV
// import. Numbers only appear once computeTrade() has parsed them.
export interface Trade {
  id: string;
  accountId: string;
  symbol: string;
  marketType: string;
  direction: Direction;
  entryPrice: string;
  stopLoss: string;
  takeProfit: string;
  exitPrice: string;
  entryDateTime: string;
  exitDateTime: string;
  riskAmount: string;
  positionSize: string;
  fees: string;
  commission: string;
  swap: string;
  entries: FillLeg[];
  exits: FillLeg[];
  notes: string;
  status: TradeStatus;
  grade: string;
  strategy: string;
  screenshots?: unknown[];
  screenshotCount?: number;
  tags: string[];
  checklist: Record<string, boolean>;
  mae: string;
  mfe: string;
}

// Everything computeTrade() derives on top of a Trade. COMPUTED_TRADE_KEYS
// below must list every key added here — stripComputed() deletes exactly
// this list before a trade is written back to storage.
export interface ComputedTrade extends Trade {
  _entry: number | null;
  _stop: number | null;
  _tp: number | null;
  _exit: number | null;
  _qty: number | null;
  _fees: number;
  _risk: number;
  _entryQty: number | null;
  _exitQty: number | null;
  _openQty: number | null;
  _commission: number | null;
  _swap: number | null;
  _entryFills: number;
  _exitFills: number;
  _scaled: boolean;
  _partial: boolean;
  _mae: number | null;
  _mfe: number | null;
  _accountName?: string;
  _loadingShots?: boolean;
  stopDistance: number | null;
  grossPnl: number | null;
  pnlAmount: number | null;
  pnlPercent: number | null;
  expectedRR: number | null;
  actualRR: number | null;
  result: TradeResult | null;
  duration: string;
}

export interface Account {
  id: string;
  name: string;
  broker: string;
  startingBalance: number;
}

export interface Goals {
  accountBalance: number;
  weeklyProfit: number;
  monthlyProfit: number;
  yearlyProfit: number;
  winRate: number;
  profitFactor: number;
  averageRR: number;
  maxDailyLoss: number;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  date: string;
  accountId: string;
  note: string;
}

export interface Settings {
  startingBalance: number;
  accounts: Account[];
  profileImage: string | null;
  journalName: string;
  journalTagline: string;
  timezone: string;
  strategyNotes: Record<string, string>;
  transactions: Transaction[];
  goals: Goals;
  checklistRules: string[];
}

export interface Filters {
  status: string; datePreset: string; dateFrom: string; dateTo: string; asset: string;
  marketType: string; direction: string; strategy: string; result: string;
  rrMin: string; rrMax: string; search: string; tag: string;
}
export interface CalendarPrefs { view: string; cursor: string; dateFrom: string; dateTo: string; }
export interface TableSort { key: string; dir: "asc" | "desc"; }

export interface Preferences {
  filters: Filters;
  calendar: CalendarPrefs;
  selectedTab: string;
  calendarView: string;
  calendarCursor: string;
  dashboardLayout: string;
  dayNotes: Record<string, string>;
  weekNotes: Record<string, string>;
  yearNotes: Record<string, string>;
  chartMode: string;
  sidebarCollapsed: boolean;
  activeAccountId: string;
  zoom: number;
  density: "comfortable" | "compact";
  hiddenColumns: string[];
  accent: string;
  tableSort: TableSort;
  pageSize: number;
  clockFormat: "12h" | "24h";
  weeklyChartCount: number;
  monthlyChartCount: number;
  yearlyChartCount: number;
  rrChartCount: number;
  hourChartCount: number;
  durationChartCount: number;
}

/* ============================================================================
   CONSTANTS
============================================================================ */
export const MARKET_TYPES = ["Crypto", "Forex", "Commodity", "Stock", "Futures"];
export const DIRECTIONS: Direction[] = ["Long", "Short"];
export const GRADES = ["A+", "A", "B", "C", "D"];
export const STATUS: TradeStatus[] = ["Open", "Closed"];
export const DEFAULT_STRATEGIES = [
  "Hybrid PA + SMC", "Price Action", "Smart Money Concepts (SMC)", "ICT",
  "Scalping", "Swing Trading", "Trend Following",
];
export const DEFAULT_GOALS: Goals = { accountBalance: 25000, weeklyProfit: 200, monthlyProfit: 1000, yearlyProfit: 12000, winRate: 55, profitFactor: 1.5, averageRR: 1.5, maxDailyLoss: 0 };
export const DEFAULT_CHECKLIST_RULES = ["Waited for confirmation", "Respected stop loss", "Followed trading plan", "No revenge trade"];

/* ---- accounts / portfolios ----
   A journal holds one or more accounts, each with its own starting balance, and
   every trade names the account it belongs to. Journals written before accounts
   existed have neither: they carry a single top-level `settings.startingBalance`
   and trades with no `accountId`. normalizeAccounts() below folds that shape
   into one account carrying the old balance, and it deliberately reuses this
   exact id — so those legacy trades, whose accountId resolves to the fallback,
   land in it rather than being stranded. `settings.startingBalance` is still
   written for that reason: an older build reading a newer journal keeps working.
   The balance of record for an account is always accounts[n].startingBalance. */
export const DEFAULT_ACCOUNT_ID = "acct-main";
export const DEFAULT_ACCOUNT_BALANCE = 10000;
// journalName/journalTagline personalise the app chrome (sidebar brand, window
// title, report headers). "" means "use the built-in name" — the default is the
// empty string rather than the product name so a journal that never set one
// keeps tracking whatever the build calls itself.
export const DEFAULT_SETTINGS: Settings = { startingBalance: DEFAULT_ACCOUNT_BALANCE, accounts: [{ id: DEFAULT_ACCOUNT_ID, name: "Main Account", broker: "", startingBalance: DEFAULT_ACCOUNT_BALANCE }], profileImage: null, journalName: "", journalTagline: "", timezone: "", strategyNotes: {}, transactions: [], goals: DEFAULT_GOALS, checklistRules: DEFAULT_CHECKLIST_RULES };
export const DEFAULT_FILTERS: Filters = { status: "", datePreset: "", dateFrom: "", dateTo: "", asset: "", marketType: "", direction: "", strategy: "", result: "", rrMin: "", rrMax: "", search: "", tag: "" };
export const DEFAULT_CALENDAR: CalendarPrefs = { view: "monthly", cursor: "", dateFrom: "", dateTo: "" };
// Window size/position now live with the desktop shell (electron/main.cjs
// persists real BrowserWindow bounds), so they are no longer tracked here.
// activeAccountId is which account the app is scoped to; "" means all of them.
// It lives here rather than in settings because it is a view choice, not data.
// zoom is the UI scale factor (1 = 100%). It rides preferences so both builds
// persist it the same way; how it is applied differs (Electron native zoom vs.
// CSS zoom) and stays in App.jsx.
// density is "comfortable" | "compact"; hiddenColumns holds trades-table column
// keys the user switched off; accent is a "#rrggbb" override for the theme's
// accent colour, "" meaning the theme's own.
// tableSort/pageSize are the trades table's sort order and rows-per-page. They
// ride preferences so the table comes back the way it was left — it unmounts on
// every tab switch, so component state alone forgets both.
export const PAGE_SIZES = [25, 50, 100];
export const DEFAULT_TABLE_SORT: TableSort = { key: "entryDateTime", dir: "desc" };
export const DEFAULT_PREFERENCES: Preferences = { filters: DEFAULT_FILTERS, calendar: DEFAULT_CALENDAR, selectedTab: "dashboard", calendarView: "monthly", calendarCursor: "", dashboardLayout: "standard", dayNotes: {}, weekNotes: {}, yearNotes: {}, chartMode: "amount", sidebarCollapsed: false, activeAccountId: "", zoom: 1, density: "comfortable", hiddenColumns: [], accent: "", tableSort: DEFAULT_TABLE_SORT, pageSize: 50, clockFormat: "12h", weeklyChartCount: 5, monthlyChartCount: 5, yearlyChartCount: 5, rrChartCount: 5, hourChartCount: 5, durationChartCount: 5 };

// The Analytics period charts (weekly/monthly/yearly) window to the most recent
// N periods; the trade-based charts (RR distribution, hour-of-day, duration)
// window to the most recent N *closed trades*. Same ladder, same picker, same
// 0 = all — anything stored outside the ladder falls back to the 5 default so a
// hand-edited value can't blank a chart.
export const CHART_PERIOD_CHOICES = [3, 5, 8, 12, 0];
export function normalizeChartCount(value: unknown): number {
  return CHART_PERIOD_CHOICES.includes(value as number) ? (value as number) : 5;
}
/* The most recent `count` trades by exit time, for the trade-based analytics
   charts' window. count 0 (or absent) = all. Trades without an exit time sort
   last (they're open, not "recent"); the input is never mutated. */
export function mostRecentTrades<T extends { exitDateTime?: string }>(trades: T[], count: number): T[] {
  const list = Array.isArray(trades) ? trades : [];
  if (!count) return list;
  return [...list]
    .sort((a, b) => String(b?.exitDateTime || "").localeCompare(String(a?.exitDateTime || "")))
    .slice(0, count);
}

// A stored accent is only ever a six-digit hex colour or "the theme's own".
// Anything else — a hand-edited backup, an old shorthand — falls back to ""
// rather than injecting junk into a CSS custom property.
export function normalizeAccent(value: unknown): string {
  if (typeof value !== "string") return "";
  const v = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(v) ? v : "";
}

/* ---- UI zoom ----
   The browser's own zoom ladder, so stepping through ours feels native. The
   step helpers are pure and live here so they can be tested; applying the
   factor (webContents vs. CSS) is App.jsx / main.cjs business. */
export const ZOOM_LEVELS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export function clampZoom(value: unknown): number {
  const z = Number(value);
  if (!Number.isFinite(z)) return 1;
  return Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], Math.max(ZOOM_LEVELS[0], z));
}
// Next level up or down from `current` (direction +1 / -1). A factor between
// two levels — e.g. restored from an older journal — snaps to the nearest
// level first, so repeated presses walk the ladder instead of drifting.
export function stepZoom(current: unknown, direction: number): number {
  const z = clampZoom(current);
  let nearest = 0;
  ZOOM_LEVELS.forEach((lvl, i) => { if (Math.abs(lvl - z) < Math.abs(ZOOM_LEVELS[nearest] - z)) nearest = i; });
  const idx = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, nearest + (direction > 0 ? 1 : -1)));
  return ZOOM_LEVELS[idx];
}

/* ---- storage keys / sharded architecture ----
   Screenshots are heavy (base64), so each trade's screenshots live in their
   own key (brij-tj-shots-<id>) and are only loaded on demand (edit/view/word
   export) instead of on every app load. Core trade records (small — no
   images) are distributed across a fixed number of shards so no single
   storage key ever approaches the 5MB per-key ceiling as the journal grows.
   This is what lets the web build stay fast well beyond a few thousand
   trades; see the Settings > Data panel for the practical ceiling of this
   architecture vs. the desktop build. ---- */
export const SHARD_COUNT = 24;
export const META_KEY = "brij-tj-meta-v1";
export const SHARD_PREFIX = "brij-tj-shard-";
export const SHOTS_PREFIX = "brij-tj-shots-";
// The login gate's user records live in their own key, deliberately outside the
// meta blob: password hashes must never ride along in a journal backup export.
export const AUTH_KEY = "brij-tj-auth-v1";
export const shardKey = (n: number): string => `${SHARD_PREFIX}${n}`;
export function djb2(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h;
}
export function shardOf(id: unknown): number { return djb2(String(id)) % SHARD_COUNT; }

/* ============================================================================
   UTILITIES
============================================================================ */
export const uid = (prefix: string): string => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();

// The sequence number inside a TJ-00001 style id, or 0 for anything else (an
// imported row, a blank). Callers use it to keep a high-water mark.
export function tradeSeq(id: unknown): number {
  const m = /TJ-(\d+)/.exec(String(id || ""));
  return m ? parseInt(m[1], 10) : 0;
}

/* The next id, one past the highest sequence yet issued.

   `floor` is that high-water mark, and it is what stops an id ever being handed
   out twice. Deriving the id from the live trade list alone is not enough: a
   deleted trade takes its number out of the list while the Undo toast is still
   holding the record, so the next trade is issued the same id and Undo then
   restores a duplicate. Two trades sharing an id share a shard entry, a React
   key and a screenshot key, and editing one rewrites both. The App seeds `floor`
   from the journal's stored counter and bumps it on every id it issues, so a
   number is retired for good the moment it is used. */
export function nextTradeId(trades: { id: string }[], floor = 0): string {
  let max = Number.isFinite(floor) ? floor : 0;
  trades.forEach((t) => { max = Math.max(max, tradeSeq(t.id)); });
  return `TJ-${String(max + 1).padStart(5, "0")}`;
}

// num / round / fmt* live in ./format so the lazily-loaded chart bundle can
// share them without importing this file back.
export function fmtDate(d: unknown): string {
  if (!d) return "—";
  const dt = new Date(d as string | number | Date);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}
export function fmtDateTime(d: unknown): string {
  if (!d) return "—";
  const dt = new Date(d as string | number | Date);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
/* The app's day key. Built from local parts, never toISOString(): every caller
   hands this a Date made from local components — a trade's exit time, a calendar
   cell, "now" — and a UTC day disagrees with all of them east or west of the
   meridian. At IST a 02:00 trade is still the 16th to the trader; toISOString()
   called it the 15th, which mis-filed it on every calendar screen. */
export function isoDate(d: unknown): string | null {
  const dt = new Date(d as string | number | Date);
  if (Number.isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
export function isoWeekKey(d: unknown): string | null {
  const dt = new Date(d as string | number | Date);
  if (Number.isNaN(dt.getTime())) return null;
  const date = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
export function monthKey(d: unknown): string | null {
  const dt = new Date(d as string | number | Date);
  if (Number.isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}
export function monthLabel(d: unknown): string {
  const dt = typeof d === "string" && /^\d{4}-\d{2}$/.test(d) ? new Date(`${d}-01T00:00:00`) : new Date(d as string | number | Date);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
}
export function weekOfMonthLabel(d: unknown): string {
  const dt = new Date(d as string | number | Date);
  if (Number.isNaN(dt.getTime())) return "—";
  const week = Math.ceil(dt.getDate() / 7);
  const month = dt.toLocaleDateString(undefined, { month: "long" });
  return `${dt.getFullYear()} - ${month} ${ordinal(week)} Week`;
}
export function weekOfMonthKey(d: unknown): string | null {
  const dt = new Date(d as string | number | Date);
  if (Number.isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-W${Math.ceil(dt.getDate() / 7)}`;
}
export function durationLabel(entry: unknown, exit: unknown): string {
  if (!entry || !exit) return "—";
  const a = new Date(entry as string | number | Date).getTime();
  const b = new Date(exit as string | number | Date).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return "—";
  const ms = b - a;
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hrs = Math.floor((mins % 1440) / 60);
  const rem = mins % 60;
  if (days > 0) return `${days}d ${hrs}h`;
  if (hrs > 0) return `${hrs}h ${rem}m`;
  return `${rem}m`;
}
export function pad(n: number): string { return String(n).padStart(2, "0"); }
export function toLocalInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function parseLocalInputValue(str: string | null | undefined): Date {
  if (!str) return new Date();
  const [datePart, timePart] = str.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = (timePart || "00:00").split(":").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
}
/* ---- Journal timezone ----------------------------------------------------
   settings.timezone ("" = follow the machine) moves only "now": today's day
   key, the date presets, the calendar's today highlight, the clock and the
   picker's prefill. Stored trade times are naive wall-clock strings and are
   never shifted — what the user typed is what every zone shows. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
export function normalizeTimezone(tz: unknown): string { return isValidTimeZone(tz) ? tz : ""; }
// Current wall-clock time in tz, returned as a naive local-parts Date so
// isoDate / dateRangeForPreset / toLocalInputValue keep working on it
// unchanged. `at` is injectable for tests; milliseconds are dropped.
export function zonedNow(tz: unknown, at: Date = new Date()): Date {
  if (!isValidTimeZone(tz)) return new Date(at);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}
// A zone's UTC offset in minutes at `at` — DST means the answer for one zone
// changes through the year, which is why this reads a live instant instead of
// a lookup table. Derived from zonedNow so the two can't disagree. NaN for an
// unknown zone id, so callers can tell "UTC" from "invalid".
export function tzOffsetMinutes(tz: unknown, at: Date = new Date()): number {
  if (!isValidTimeZone(tz)) return NaN;
  const utcNaive = new Date(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds());
  return Math.round((zonedNow(tz, at).getTime() - utcNaive.getTime()) / 60000);
}
// "GMT+5:30" / "GMT-4" — the display form of the offset above.
export function tzOffsetLabel(tz: unknown, at: Date = new Date()): string {
  const mins = tzOffsetMinutes(tz, at);
  if (Number.isNaN(mins)) return "";
  const abs = Math.abs(mins);
  const rem = abs % 60;
  return `GMT${mins < 0 ? "-" : "+"}${Math.floor(abs / 60)}${rem ? `:${pad(rem)}` : ""}`;
}
/* Coerce whatever is on file into a usable account list. Anything that reaches
   here can be from a journal older than accounts, a hand-edited backup, or a
   restore — so the one guarantee it makes is that the result is never empty and
   every entry has an id, because the whole app resolves a trade's account
   against this list and falls back to its first entry. */
export function normalizeAccounts(accounts: unknown, legacyBalance: unknown): Account[] {
  const list: Account[] = (Array.isArray(accounts) ? accounts : [])
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .map((a, i) => ({
      id: (a.id as string) || `${DEFAULT_ACCOUNT_ID}-${i}`,
      name: ((a.name as string) || "").trim() || `Account ${i + 1}`,
      broker: (a.broker as string) || "",
      startingBalance: num(a.startingBalance, 0) || 0,
    }));
  if (list.length) return list;
  // No accounts on file: this journal predates them. Its single balance becomes
  // the one account, under the id legacy trades resolve to.
  return [{ id: DEFAULT_ACCOUNT_ID, name: "Main Account", broker: "", startingBalance: num(legacyBalance, DEFAULT_ACCOUNT_BALANCE) as number }];
}
// Free text destined for the app chrome: never anything but a trimmed string,
// capped so a paste can't blow out the sidebar or a report header.
function cleanBrandText(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}
/* Strategy playbook notes, keyed by strategy name. Notes are text the user
   typed, so the only jobs here are shape (a plain object of strings), dropping
   entries whose note is blank, and a length cap so a stray paste can't bloat
   the meta record. A note whose strategy was renamed or removed is kept — the
   name coming back (or a trade still carrying it) finds its notes intact. */
export function normalizeStrategyNotes(notes: unknown): Record<string, string> {
  if (!notes || typeof notes !== "object" || Array.isArray(notes)) return {};
  const out: Record<string, string> = {};
  for (const [name, text] of Object.entries(notes as Record<string, unknown>)) {
    if (typeof text === "string" && text.trim()) out[name] = text.slice(0, 5000);
  }
  return out;
}
/* ---- Cashflow (deposits & withdrawals) -----------------------------------
   Money moving in or out of an account, independent of trade P&L: a deposit
   adds to the balance, a withdrawal subtracts. Each transaction belongs to an
   account like a trade does, and an unknown accountId resolves to the first
   account at read time, so deleting an account never orphans its cash history.
   The amount is always stored positive — the sign lives in `type` — so a
   hand-edited "-50" deposit can't quietly become a withdrawal. Blank or
   non-positive amounts drop, the same way a blank journal note does. */
export const TRANSACTION_TYPES: TransactionType[] = ["deposit", "withdrawal"];
export function normalizeTransactions(transactions: unknown): Transaction[] {
  return (Array.isArray(transactions) ? transactions : [])
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object" && TRANSACTION_TYPES.includes(t.type as TransactionType))
    .map((t) => ({
      id: (t.id as string) || uid("TXN"),
      type: t.type as TransactionType,
      amount: Math.abs(num(t.amount, 0) || 0) || 0,
      // A day key ("YYYY-MM-DD") or a datetime-local string; kept verbatim, the
      // way trade times are, and compared on its first ten chars for filtering.
      date: typeof t.date === "string" ? t.date : "",
      accountId: (t.accountId as string) || "",
      note: typeof t.note === "string" ? t.note.slice(0, 500) : "",
    }))
    .filter((t) => t.amount > 0);
}
// Net cash moved by a set of transactions: deposits add, withdrawals subtract.
export function transactionsNet(transactions: unknown): number {
  return (Array.isArray(transactions) ? transactions : []).reduce(
    (sum: number, t: Record<string, unknown>) => sum + (t.type === "withdrawal" ? -1 : 1) * (Math.abs(num(t.amount, 0) || 0) || 0),
    0
  );
}
/* The Cashflow tab's own filter — applied to the list AND its running-balance
   column, so what's on screen is exactly what the numbers sum. Self-contained
   to this tab (the request was explicit that it touches nothing else): date
   range (inclusive, day-compared like the journal filter), type, and note text.
   Mirrors filterJournalEntries. */
export function filterTransactions(transactions: Transaction[], filter: { from?: string; to?: string; type?: string; search?: string } = {}): Transaction[] {
  const { from = "", to = "", type = "", search = "" } = filter;
  const needle = search.trim().toLowerCase();
  return (Array.isArray(transactions) ? transactions : []).filter((t) => {
    if (type && t.type !== type) return false;
    const day = (t.date || "").slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (needle && !(t.note || "").toLowerCase().includes(needle)) return false;
    return true;
  });
}
// Transactions newest first, with each account-unknown id resolved to the first
// account the way trades resolve — so a deleted account's cash still shows in
// the pooled view rather than vanishing. accounts[0] is the documented fallback.
export function sortedTransactions(transactions: unknown, accounts: Account[] | undefined): Transaction[] {
  const ids = new Set((accounts || []).map((a) => a.id));
  const fallback = accounts?.[0]?.id || DEFAULT_ACCOUNT_ID;
  return normalizeTransactions(transactions)
    .map((t) => ({ ...t, accountId: ids.has(t.accountId) ? t.accountId : fallback }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export function mergeSettings(settings: unknown): Settings {
  const s = (settings || {}) as Partial<Settings> & { [key: string]: unknown };
  const accounts = normalizeAccounts(s.accounts, s.startingBalance);
  return {
    ...DEFAULT_SETTINGS, ...s,
    accounts,
    // Kept in step with the first account purely so a build older than accounts
    // can still read this journal's balance. Nothing in this build reads it.
    startingBalance: accounts[0].startingBalance,
    journalName: cleanBrandText(s.journalName, 40),
    journalTagline: cleanBrandText(s.journalTagline, 60),
    // An unknown or malformed zone falls back to "" (follow the machine), so a
    // journal restored on a runtime with an older tz database still loads.
    timezone: normalizeTimezone(s.timezone),
    strategyNotes: normalizeStrategyNotes(s.strategyNotes),
    transactions: normalizeTransactions(s.transactions),
    goals: { ...DEFAULT_GOALS, ...(s.goals || {}) },
    checklistRules: s.checklistRules?.length ? s.checklistRules : DEFAULT_CHECKLIST_RULES,
  };
}
export function mergePreferences(preferences: unknown): Preferences {
  const prefs = (preferences || {}) as Partial<Preferences> & { [key: string]: unknown };
  return {
    ...DEFAULT_PREFERENCES,
    ...prefs,
    filters: { ...DEFAULT_FILTERS, ...(prefs.filters || {}) },
    calendar: { ...DEFAULT_CALENDAR, ...(prefs.calendar || {}), view: prefs.calendar?.view || (prefs as Record<string, unknown>).calendarView as string || DEFAULT_CALENDAR.view, cursor: prefs.calendar?.cursor || (prefs as Record<string, unknown>).calendarCursor as string || "" },
    dayNotes: prefs.dayNotes || {},
    weekNotes: prefs.weekNotes || {},
    yearNotes: prefs.yearNotes || {},
    zoom: clampZoom(prefs.zoom ?? 1),
    density: prefs.density === "compact" ? "compact" : "comfortable",
    clockFormat: prefs.clockFormat === "24h" ? "24h" : "12h",
    weeklyChartCount: normalizeChartCount(prefs.weeklyChartCount),
    monthlyChartCount: normalizeChartCount(prefs.monthlyChartCount),
    yearlyChartCount: normalizeChartCount(prefs.yearlyChartCount),
    rrChartCount: normalizeChartCount(prefs.rrChartCount),
    hourChartCount: normalizeChartCount(prefs.hourChartCount),
    durationChartCount: normalizeChartCount(prefs.durationChartCount),
    hiddenColumns: Array.isArray(prefs.hiddenColumns) ? prefs.hiddenColumns.filter((k): k is string => typeof k === "string") : [],
    accent: normalizeAccent(prefs.accent),
    // Guaranteed shapes, whatever was stored: a junk sort key still sorts (the
    // comparator reads undefined fields without throwing), but dir and pageSize
    // are constrained so a hand-edited value can't wedge the table.
    tableSort: {
      key: typeof prefs.tableSort?.key === "string" && prefs.tableSort.key ? prefs.tableSort.key : DEFAULT_TABLE_SORT.key,
      dir: prefs.tableSort?.dir === "asc" ? "asc" : "desc",
    },
    pageSize: PAGE_SIZES.includes(prefs.pageSize as number) ? (prefs.pageSize as number) : 50,
  };
}

/* ---- command palette matching ----
   Ranks palette items (actions, trades) against a typed query. Pure so it can
   be tested; the palette UI itself lives in App.jsx. Matching is token-AND:
   every whitespace-separated token must appear somewhere in the item's
   haystack, so "btc long" finds a trade whose haystack holds both, in either
   order. Ranking prefers matches at a word start over mid-word, then earlier
   over later, then the caller's original order — which is how "the actions I
   listed first win ties" is expressed. */
export function paletteFilter<T extends { haystack?: string }>(query: string, items: T[], limit = 8): T[] {
  const list = Array.isArray(items) ? items : [];
  const tokens = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return list.slice(0, limit);
  const scored: { item: T; score: number; order: number }[] = [];
  for (let order = 0; order < list.length; order++) {
    const hay = String(list[order]?.haystack || "").toLowerCase();
    let score = 0;
    let matched = true;
    for (const tok of tokens) {
      const idx = hay.indexOf(tok);
      if (idx === -1) { matched = false; break; }
      // A mid-word hit ("rt" inside "chart") is a much weaker signal than a
      // word-start one, so it carries a fixed penalty on top of its position.
      const atWordStart = idx === 0 || /\s/.test(hay[idx - 1]);
      score += idx + (atWordStart ? 0 : 100);
    }
    if (matched) scored.push({ item: list[order], score, order });
  }
  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  return scored.slice(0, limit).map((s) => s.item);
}
export function startOfWeek(date: unknown): Date {
  const dt = new Date(date as string | number | Date);
  const day = dt.getDay();
  dt.setDate(dt.getDate() - day);
  dt.setHours(0, 0, 0, 0);
  return dt;
}
export interface DateRange { from: string | null; to: string | null; label: string; }
export function dateRangeForPreset(preset: string, cursor: Date | string = new Date(), customFrom = "", customTo = ""): DateRange {
  const now = new Date(cursor || new Date());
  if (preset === "today" || preset === "daily") return { from: isoDate(now), to: isoDate(now), label: "Today" };
  if (preset === "week" || preset === "weekly") {
    const start = startOfWeek(now);
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return { from: isoDate(start), to: isoDate(end), label: "This Week" };
  }
  if (preset === "month" || preset === "monthly") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: isoDate(start), to: isoDate(end), label: "This Month" };
  }
  if (preset === "year" || preset === "yearly") {
    return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31`, label: "This Year" };
  }
  if (preset === "custom") return { from: customFrom, to: customTo, label: customFrom || customTo ? "Custom Range" : "All Dates" };
  return { from: "", to: "", label: "All Dates" };
}
export function dateInRange(value: unknown, from: string, to: string): boolean {
  const k = isoDate(value);
  if (!k) return false;
  if (from && k < from) return false;
  if (to && k > to) return false;
  return true;
}
export interface PerformanceRow {
  [labelKey: string]: unknown;
  sortKey: string;
  pnl: number;
  pnlPercentSum: number;
  pnlPercentCount: number;
  trades: number;
  wins: number;
  losses: number;
  grossProfit: number;
  grossLoss: number;
  pnlPercent: number;
  winRate: number;
  profitFactor: number;
}
export function groupPerformance(trades: ComputedTrade[], keyFn: (exitDateTime: string) => string | { key: string; label?: string; sortKey?: string }, labelKey: string): PerformanceRow[] {
  const map: Record<string, PerformanceRow> = {};
  trades.filter((t) => t.status === "Closed" && t.pnlAmount !== null && t.exitDateTime).forEach((t) => {
    const raw = keyFn(t.exitDateTime);
    const key = typeof raw === "object" ? raw.key : raw;
    if (!key) return;
    if (!map[key]) map[key] = { [labelKey]: typeof raw === "object" ? raw.label : key, sortKey: typeof raw === "object" ? raw.sortKey || key : key, pnl: 0, pnlPercentSum: 0, pnlPercentCount: 0, trades: 0, wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, pnlPercent: 0, winRate: 0, profitFactor: 0 };
    map[key].pnl += t.pnlAmount as number;
    map[key].trades += 1;
    if (t.result === "win") map[key].wins += 1;
    if (t.result === "loss") map[key].losses += 1;
    if ((t.pnlAmount as number) > 0) map[key].grossProfit += t.pnlAmount as number;
    if ((t.pnlAmount as number) < 0) map[key].grossLoss += Math.abs(t.pnlAmount as number);
    if (Number.isFinite(t.pnlPercent)) { map[key].pnlPercentSum += t.pnlPercent as number; map[key].pnlPercentCount += 1; }
  });
  return Object.values(map).sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey))).map((row) => ({
    ...row,
    pnl: Math.round(row.pnl * 100) / 100,
    pnlPercent: row.pnlPercentCount ? Math.round((row.pnlPercentSum / row.pnlPercentCount) * 10) / 10 : 0,
    winRate: row.trades ? Math.round((row.wins / row.trades) * 1000) / 10 : 0,
    profitFactor: row.grossLoss !== 0 ? row.grossProfit / row.grossLoss : (row.grossProfit > 0 ? Infinity : 0),
  }));
}
export function goalProgress(value: number, target: unknown): number {
  const safeTarget = Math.max(Math.abs(num(target, 0) || 0), 0.000001);
  return Math.max(0, Math.min(100, (value / safeTarget) * 100));
}

/* ----------------------------------------------------------------------------
   CORE TRADE CALCULATIONS
   - Expected RR  = reward distance (Entry -> Take Profit) / risk distance (Entry -> Stop Loss)
   - Actual RR    = reward distance actually captured (Entry -> Exit) / risk distance (Entry -> Stop Loss)
   Both are derived purely from price levels, direction-aware, and recompute
   automatically the moment Entry / Stop Loss / Take Profit / Exit change —
   never entered manually.

   The derivation is pure and trade records are always replaced rather than
   mutated in place, so results are cached against the source object. Editing one
   trade then recomputes that one row instead of the whole journal. A WeakMap
   keeps the cache tied to the lifetime of the trades themselves.

   This caching is only sound while trades stay immutable — mutating a trade
   object in place would hand back a stale derivation.
---------------------------------------------------------------------------- */
const computedTradeCache = new WeakMap<Trade, ComputedTrade>();
export function computeTrade(t: Trade): ComputedTrade {
  if (!t || typeof t !== "object") return computeTradeFresh(t);
  const cached = computedTradeCache.get(t);
  if (cached) return cached;
  const result = computeTradeFresh(t);
  computedTradeCache.set(t, result);
  return result;
}
export interface AggregatedFill { qty: number; avgPrice: number; firstAt: string | null; lastAt: string | null; }
/* Collapse a trade's fill legs into the single fill the rest of the app reasons
   about: one size-weighted average price, one total quantity, and the span of
   time the legs cover. Scaling into a position at 100 and 90 with a lot each is
   arithmetically one lot-weighted fill at 95, so every downstream metric — RR,
   P&L, the charts — needs no notion of legs at all.

   Returns null when there is nothing usable (no legs, or none with both a price
   and a positive quantity), which is the signal to fall back to the trade's
   plain entryPrice / exitPrice / positionSize. A leg missing a price or size is
   skipped rather than counted as zero, which would drag the average down. */
export function aggregateLegs(legs: unknown): AggregatedFill | null {
  if (!Array.isArray(legs) || !legs.length) return null;
  let qty = 0, notional = 0;
  let firstAt: string | null = null, lastAt: string | null = null, firstTs = Infinity, lastTs = -Infinity;
  (legs as Partial<FillLeg>[]).forEach((leg) => {
    if (!leg) return;
    const price = num(leg.price);
    const legQty = num(leg.qty);
    if (leg.datetime) {
      const ts = new Date(leg.datetime).getTime();
      if (Number.isFinite(ts)) {
        if (ts < firstTs) { firstTs = ts; firstAt = leg.datetime; }
        if (ts > lastTs) { lastTs = ts; lastAt = leg.datetime; }
      }
    }
    if (price === null || legQty === null || legQty <= 0) return;
    qty += legQty;
    notional += price * legQty;
  });
  if (qty <= 0) return null;
  return { qty, avgPrice: notional / qty, firstAt, lastAt };
}

function computeTradeFresh(t: Trade): ComputedTrade {
  // Legs win over the plain price/size fields when present. The form keeps those
  // fields mirrored to these same averages, so the two agree; this path is what
  // makes the aggregate exact rather than re-parsed from a rounded mirror.
  const entryFill = aggregateLegs(t.entries);
  const exitFill = aggregateLegs(t.exits);

  const entry = entryFill ? entryFill.avgPrice : num(t.entryPrice);
  const stop = num(t.stopLoss);
  const tp = num(t.takeProfit);
  const exit = exitFill ? exitFill.avgPrice : num(t.exitPrice);

  const entryQty = entryFill ? entryFill.qty : num(t.positionSize);
  // No exit legs means the whole position left at exitPrice — the pre-legs
  // behaviour, where size is simply the position size.
  const exitQty = exitFill ? exitFill.qty : entryQty;
  // P&L is only ever earned on size that both entered and left. Scaling out of
  // half a position realises half of it; the rest is still open and has no
  // realised P&L to claim yet.
  const qty = (entryQty !== null && exitQty !== null) ? Math.min(entryQty, exitQty) : entryQty;
  const openQty = (entryQty !== null && exitQty !== null) ? Math.max(0, entryQty - exitQty) : null;

  /* Fees split into commission and swap/overnight. Either one present means the
     trade uses the split and the total is their sum — a blank counts as zero, so
     a commission-only trade doesn't need a "0" typed into swap. With neither,
     this is a journal (or a CSV import) that only ever knew one fees number, and
     that number is the total. */
  const commission = num(t.commission);
  const swap = num(t.swap);
  const hasFeeSplit = commission !== null || swap !== null;
  const fees = hasFeeSplit ? (commission ?? 0) + (swap ?? 0) : (num(t.fees, 0) || 0);

  const risk = num(t.riskAmount, 0) || 0;
  const direction: Direction = t.direction === "Short" ? "Short" : "Long";

  const stopDistance = (entry !== null && stop !== null && entry !== stop) ? Math.abs(entry - stop) : null;

  let expectedRR: number | null = null;
  if (entry !== null && tp !== null && stopDistance) {
    const rewardDistance = direction === "Short" ? (entry - tp) : (tp - entry);
    expectedRR = rewardDistance / stopDistance;
  }

  let actualRR: number | null = null;
  if (entry !== null && exit !== null && stopDistance) {
    const capturedDistance = direction === "Short" ? (entry - exit) : (exit - entry);
    actualRR = capturedDistance / stopDistance;
  }

  let grossPnl: number | null = null, pnlAmount: number | null = null, pnlPercent: number | null = null, result: TradeResult | null = null;
  const closed = t.status === "Closed";
  if (closed && entry !== null && exit !== null && qty !== null) {
    grossPnl = direction === "Short" ? (entry - exit) * qty : (exit - entry) * qty;
    pnlAmount = grossPnl - fees;
    const notional = entry * qty;
    pnlPercent = notional !== 0 ? (pnlAmount / notional) * 100 : 0;
    result = pnlAmount > 1e-7 ? "win" : pnlAmount < -1e-7 ? "loss" : "breakeven";
  }
  if (!closed) actualRR = null;

  // Legs, when present, are the record of when the trade actually opened and
  // closed — first fill in, last fill out. Overriding the two date fields here
  // means filtering, the calendar and the time-of-day charts all read the real
  // span without any of them knowing legs exist.
  const entryDateTime = entryFill?.firstAt || t.entryDateTime;
  const exitDateTime = exitFill?.lastAt || t.exitDateTime;

  return {
    ...t,
    entryDateTime, exitDateTime,
    _entry: entry, _stop: stop, _tp: tp, _exit: exit, _qty: qty, _fees: fees, _risk: risk,
    _entryQty: entryQty, _exitQty: exitQty, _openQty: openQty,
    _commission: hasFeeSplit ? (commission ?? 0) : null,
    _swap: hasFeeSplit ? (swap ?? 0) : null,
    _entryFills: t.entries?.length || 0, _exitFills: t.exits?.length || 0,
    _scaled: !!(entryFill || exitFill),
    // Size that entered but hasn't left. Only meaningful once something has been
    // scaled out — a plain open trade hasn't part-closed, it just hasn't closed.
    _partial: !!(exitFill && openQty !== null && openQty > 1e-9),
    _mae: num(t.mae), _mfe: num(t.mfe),
    stopDistance, grossPnl, pnlAmount, pnlPercent, expectedRR, actualRR, result,
    duration: durationLabel(entryDateTime, exitDateTime),
  };
}

/* Everything computeTrade() derives, stripped back off before a trade is
   written. The form edits a computed trade, so without this the derived fields
   ride along into storage — stale copies of numbers that are recalculated on
   every read anyway, inflating every shard for no gain. */
export const COMPUTED_TRADE_KEYS = [
  "_entry", "_stop", "_tp", "_exit", "_qty", "_fees", "_risk", "_entryQty", "_exitQty", "_openQty",
  "_commission", "_swap", "_entryFills", "_exitFills", "_scaled", "_partial", "_mae", "_mfe",
  "_accountName", "_loadingShots",
  "stopDistance", "grossPnl", "pnlAmount", "pnlPercent", "expectedRR", "actualRR", "result", "duration",
];
export function stripComputed(trade: Partial<ComputedTrade>): Trade {
  const core: Record<string, unknown> = { ...trade };
  COMPUTED_TRADE_KEYS.forEach((k) => delete core[k]);
  return core as unknown as Trade;
}

/* ============================================================================
   EXPORT PLUMBING (pure half — the file-saving side stays in App.jsx)
============================================================================ */
// Escape text destined for an HTML/Word report. Trade symbols, strategy names
// and notes are free text; interpolated raw they can break the document markup
// (a note containing "<" or "&") or inject unintended tags.
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// One CSV field: quote when it contains a comma, quote, or newline, and double
// up embedded quotes — the same escaping parseCSV() reads back.
/* ---- Journal export -------------------------------------------------------
   The journal has three note stores, one per grain: preferences.dayNotes
   (keyed by isoDate — the same store the calendar edits), preferences.weekNotes
   (isoWeekKey, `2026-W29`), preferences.yearNotes (`2026`). Each has its own
   tab section and its own filter. `journalEntries` reads any of them: the
   `kind` picks the key shape it keeps, so a blank note or a mis-shaped key
   (the pre-fix UTC day-key stragglers in ARCHITECTURE.md § Dates are still
   day-shaped and survive) is dropped. All three formats are zero-padded and
   sort lexically into chronological order, so entries come out newest first. */
export type JournalGrain = "day" | "week" | "year";
export type JournalEntry = [string, string];
export const JOURNAL_KEY_PATTERNS: Record<JournalGrain, RegExp> = { day: /^\d{4}-\d{2}-\d{2}$/, week: /^\d{4}-W\d{2}$/, year: /^\d{4}$/ };
export function journalEntries(notes: Record<string, string> | undefined | null, kind: JournalGrain = "day"): JournalEntry[] {
  const pat = JOURNAL_KEY_PATTERNS[kind] || JOURNAL_KEY_PATTERNS.day;
  return Object.entries(notes || {})
    .filter(([key, text]) => pat.test(key) && typeof text === "string" && text.trim())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1));
}
/* The Journal tab's filter, applied to the list AND every export so what you
   see is exactly what a file will hold: an inclusive day-key range plus a
   case-insensitive text match on the note. Day keys compare lexically, which
   for YYYY-MM-DD is date order. An empty filter passes everything. */
export function filterJournalEntries(entries: JournalEntry[], { from = "", to = "", search = "" }: { from?: string; to?: string; search?: string } = {}): JournalEntry[] {
  const q = search.trim().toLowerCase();
  return entries.filter(([date, text]) => {
    if (from && date < from) return false;
    if (to && date > to) return false;
    if (q && !text.toLowerCase().includes(q)) return false;
    return true;
  });
}
export interface JournalDayInfo { pnl: number; count: number; }
/* The exporters below take the entries ARRAY (from journalEntries, optionally
   through filterJournalEntries), not the raw dayNotes map — the Journal tab
   filters before exporting, and re-deriving inside each exporter would undo
   that. byDay is optional { [dayKey]: { pnl, count } } — when given, each
   entry's heading carries that day's trading result next to the note. */
export function journalToMarkdown(entries: JournalEntry[], byDay: Record<string, JournalDayInfo> = {}): string {
  const blocks = entries.map(([date, text]) => {
    const info = byDay[date];
    const stats = info ? ` — ${info.count} trade${info.count === 1 ? "" : "s"}, P&L ${info.pnl < 0 ? "-" : "+"}$${Math.abs(info.pnl).toFixed(2)}` : "";
    return `## ${date}${stats}\n\n${text.trim()}`;
  });
  return `# Trading Journal\n\n${blocks.join("\n\n")}\n`;
}
export function journalToCSV(entries: JournalEntry[]): string {
  return ["Date,Note", ...entries.map(([date, text]) => `${date},${csvCell(text.trim())}`)].join("\n");
}
/* One HTML document for the Word (.doc) and PDF journal exports, mirroring the
   trade report's split: forWord adds the Office namespaces Word wants, the PDF
   path gets @page sizing instead. Note text is user free text and is escaped;
   the date needs no escaping — journalEntries only passes YYYY-MM-DD keys. */
export function journalToHtml(entries: JournalEntry[], byDay: Record<string, JournalDayInfo> = {}, { title = "Trading Journal", forWord = false, generatedLabel = "" }: { title?: string; forWord?: boolean; generatedLabel?: string } = {}): string {
  const blocks = entries.map(([date, text]) => {
    const info = byDay[date];
    const stats = info ? ` — ${info.count} trade${info.count === 1 ? "" : "s"}, P&amp;L ${info.pnl < 0 ? "-" : "+"}$${Math.abs(info.pnl).toFixed(2)}` : "";
    return `<h2>${date}${stats}</h2><p>${escapeHtml(text.trim()).replace(/\n/g, "<br/>")}</p>`;
  }).join("");
  const nsAttrs = forWord ? " xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'" : "";
  const pageCss = forWord ? "" : "@page{size:A4;margin:14mm;} ";
  return `<html${nsAttrs}><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    `<style>${pageCss}body{font-family:Calibri,Arial,sans-serif;color:#1a1a1a;} h1{color:#161A22;margin-bottom:0;} h2{border-bottom:2px solid #3E8FFF;padding-bottom:4px;font-size:15px;} p{font-size:12px;line-height:1.5;}</style></head>` +
    `<body><h1>${escapeHtml(title)}</h1>${generatedLabel ? `<p style="color:#888;margin-top:2px">${escapeHtml(generatedLabel)}</p>` : ""}${blocks}</body></html>`;
}
export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const CSV_EXPORT_COLUMNS: [string, (t: ComputedTrade) => unknown][] = [
  ["Trade ID", (t) => t.id],
  ["Account", (t) => t._accountName || ""],
  ["Symbol", (t) => t.symbol],
  ["Market", (t) => t.marketType],
  ["Direction", (t) => t.direction],
  ["Status", (t) => t.status],
  ["Grade", (t) => t.grade],
  ["Strategy", (t) => t.strategy],
  ["Entry Price", (t) => t._entry],
  ["Stop Loss", (t) => t._stop],
  ["Take Profit", (t) => t._tp],
  ["Exit Price", (t) => t._exit],
  ["Entry Time", (t) => t.entryDateTime],
  ["Exit Time", (t) => t.exitDateTime],
  ["Duration", (t) => t.duration],
  ["Position Size", (t) => t._entryQty],
  ["Closed Size", (t) => t._qty],
  ["Open Size", (t) => t._openQty],
  ["Entry Fills", (t) => t._entryFills],
  ["Exit Fills", (t) => t._exitFills],
  ["Commission", (t) => t._commission],
  ["Swap", (t) => t._swap],
  ["Fees", (t) => t._fees],
  ["Risk Amount", (t) => t._risk],
  ["Expected RR", (t) => (t.expectedRR !== null && t.expectedRR !== undefined ? round(t.expectedRR, 2) : "")],
  ["Actual RR", (t) => (t.actualRR !== null && t.actualRR !== undefined ? round(t.actualRR, 2) : "")],
  ["P&L Amount", (t) => (t.pnlAmount !== null && t.pnlAmount !== undefined ? round(t.pnlAmount, 2) : "")],
  ["P&L %", (t) => (t.pnlPercent !== null && t.pnlPercent !== undefined ? round(t.pnlPercent, 2) : "")],
  ["Result", (t) => t.result],
  ["Notes", (t) => t.notes],
];
export function tradesToCSV(trades: ComputedTrade[]): string {
  const header = CSV_EXPORT_COLUMNS.map(([name]) => csvCell(name)).join(",");
  const lines = trades.map((t) => CSV_EXPORT_COLUMNS.map(([, get]) => csvCell(get(t))).join(","));
  return [header, ...lines].join("\r\n");
}

/* ============================================================================
   CSV IMPORT — generic column-alias mapper for MT4/5, Binance & TradingView
   history exports. Each canonical field accepts several common header
   spellings; anything unrecognized is left blank rather than guessed.
============================================================================ */
export type CsvRow = Record<string, string>;
export function parseCSV(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((v) => v !== "")) rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
}
/* Column aliases, lower-cased. Besides the broker spellings, every alias list
   also carries the header this app's own CSV export writes (see
   CSV_EXPORT_COLUMNS), so a file exported here re-imports without losing
   fields. */
export const CSV_FIELD_ALIASES: Record<string, string[]> = {
  symbol: ["symbol", "pair", "ticker", "instrument"],
  direction: ["type", "side", "direction"],
  entryPrice: ["open price", "entry price", "price", "open"],
  exitPrice: ["close price", "exit price", "close"],
  stopLoss: ["s/l", "stop loss", "sl"],
  takeProfit: ["t/p", "take profit", "tp"],
  positionSize: ["size", "lots", "quantity", "qty", "volume", "contracts", "position size"],
  // Commission and swap were one alias list until the two were tracked apart.
  // An MT4/MT5 statement has a column for each, and the single list could only
  // ever keep whichever appeared first — the other cost was dropped on import.
  commission: ["commission", "commissions", "fee", "fees"],
  swap: ["swap", "swaps", "rollover", "financing", "funding", "funding fee", "overnight"],
  entryDateTime: ["open time", "entry time", "entry date", "date/time", "date"],
  exitDateTime: ["close time", "exit time", "exit date"],
  riskAmount: ["risk amount"],
  marketType: ["market", "market type"],
  grade: ["grade"],
  strategy: ["strategy", "setup"],
  notes: ["notes", "comment", "comments"],
};

// Free-text columns can hold anything; keep a value only when it is one of the
// options the app actually offers, so an unknown grade or market from someone
// else's CSV falls back to the default rather than sticking an unusable value
// on the trade.
export function csvEnumField(row: CsvRow, aliases: string[], allowed: string[]): string {
  const raw = findCsvField(row, aliases).trim();
  return allowed.find((opt) => opt.toLowerCase() === raw.toLowerCase()) || "";
}
export function findCsvField(row: CsvRow, aliases: string[]): string {
  const keys = Object.keys(row);
  // A present-but-empty aliased column must not shadow a later alias that holds
  // the value: our own export writes Commission,Swap,Fees side by side, and a
  // pre-split trade fills only Fees — matching the empty Commission column
  // would zero the cost on re-import. A column with a real value still wins in
  // row order, so an MT4 statement's Commission beats its Fees.
  const match = keys.find((k) => aliases.includes(k.trim().toLowerCase()) && String(row[k]).trim() !== "");
  return match ? row[match] : "";
}
export function normalizeCsvDate(str: string | undefined | null): string {
  if (!str) return "";
  const cleaned = str.trim().replace(/^(\d{4})\.(\d{2})\.(\d{2})/, "$1-$2-$3");
  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? "" : toLocalInputValue(d);
}
export function rowsToTrades(rows: CsvRow[], lastDefaults: Record<string, unknown> | undefined): Trade[] {
  return rows.map((row) => {
    const dirRaw = findCsvField(row, CSV_FIELD_ALIASES.direction).toLowerCase();
    const direction: Direction = /sell|short|^1$/.test(dirRaw) ? "Short" : "Long";
    const exitPrice = findCsvField(row, CSV_FIELD_ALIASES.exitPrice);
    const commission = findCsvField(row, CSV_FIELD_ALIASES.commission);
    const swap = findCsvField(row, CSV_FIELD_ALIASES.swap);
    const t = emptyTrade(lastDefaults);
    return {
      ...t,
      symbol: findCsvField(row, CSV_FIELD_ALIASES.symbol).toUpperCase() || t.symbol,
      direction,
      entryPrice: findCsvField(row, CSV_FIELD_ALIASES.entryPrice),
      exitPrice,
      stopLoss: findCsvField(row, CSV_FIELD_ALIASES.stopLoss),
      takeProfit: findCsvField(row, CSV_FIELD_ALIASES.takeProfit),
      positionSize: findCsvField(row, CSV_FIELD_ALIASES.positionSize),
      commission, swap,
      // The total of record, so a row with neither column still reads as $0 of
      // fees rather than an absent one.
      fees: String(round((num(commission, 0) || 0) + (num(swap, 0) || 0), 8)),
      riskAmount: findCsvField(row, CSV_FIELD_ALIASES.riskAmount) || t.riskAmount,
      marketType: csvEnumField(row, CSV_FIELD_ALIASES.marketType, MARKET_TYPES) || t.marketType,
      grade: csvEnumField(row, CSV_FIELD_ALIASES.grade, GRADES) || t.grade,
      strategy: findCsvField(row, CSV_FIELD_ALIASES.strategy) || t.strategy,
      notes: findCsvField(row, CSV_FIELD_ALIASES.notes),
      entryDateTime: normalizeCsvDate(findCsvField(row, CSV_FIELD_ALIASES.entryDateTime)),
      exitDateTime: normalizeCsvDate(findCsvField(row, CSV_FIELD_ALIASES.exitDateTime)),
      status: (exitPrice ? "Closed" : "Open") as TradeStatus,
    };
  }).filter((t) => t.symbol && t.entryPrice);
}

/* A trade's identity for import de-duplication: same symbol opened at the same
   minute. Deliberately not id-based — a re-imported broker statement has no ids
   to match on — and null (never a match) when either half is missing, so a
   dateless row can't collide with every other dateless row on that symbol. */
function importDupKey(t: { symbol?: string; entryDateTime?: string } | undefined): string | null {
  const symbol = String(t?.symbol || "").trim().toUpperCase();
  const opened = String(t?.entryDateTime || "").trim();
  return symbol && opened ? `${symbol}|${opened}` : null;
}
/* Split incoming rows into ones the journal has never seen and ones that match
   an existing trade (same symbol + entry time) — the shape of a statement being
   imported twice. The caller decides what to do with the duplicates; nothing is
   dropped here. */
export function partitionDuplicateImports<T extends { symbol?: string; entryDateTime?: string }>(existing: T[] | undefined, incoming: T[] | undefined): { fresh: T[]; duplicates: T[] } {
  const seen = new Set((existing || []).map(importDupKey).filter(Boolean));
  const fresh: T[] = [], duplicates: T[] = [];
  (incoming || []).forEach((t) => {
    const key = importDupKey(t);
    (key && seen.has(key) ? duplicates : fresh).push(t);
  });
  return { fresh, duplicates };
}

/* ============================================================================
   AGGREGATE STATS
============================================================================ */
export interface SummaryStats {
  count: number; wins: number; losses: number; winRate: number | null;
  net: number; grossProfit: number; grossLoss: number; grossLossAbs: number;
  avgRR: number | null; avgPnlPercent: number | null; profitFactor: number | null;
}
export function summarize(list: ComputedTrade[]): SummaryStats {
  const closed = list.filter((t) => t.status === "Closed" && t.pnlAmount !== null);
  const wins = closed.filter((t) => t.result === "win");
  const losses = closed.filter((t) => t.result === "loss");
  const grossProfit = wins.reduce((s, t) => s + (t.pnlAmount as number), 0);
  const grossLoss = losses.reduce((s, t) => s + (t.pnlAmount as number), 0);
  const grossLossAbs = Math.abs(grossLoss);
  const net = grossProfit + grossLoss;
  const winRate = closed.length ? (wins.length / closed.length) * 100 : null;
  const rrs = closed.map((t) => t.actualRR).filter((v): v is number => v !== null && Number.isFinite(v));
  const avgRR = rrs.length ? rrs.reduce((s, v) => s + v, 0) / rrs.length : null;
  const pnlPercents = closed.map((t) => t.pnlPercent).filter((v): v is number => Number.isFinite(v));
  const avgPnlPercent = pnlPercents.length ? pnlPercents.reduce((s, v) => s + v, 0) / pnlPercents.length : null;
  const profitFactor = grossLossAbs !== 0 ? grossProfit / grossLossAbs : (grossProfit > 0 ? Infinity : null);
  return { count: closed.length, wins: wins.length, losses: losses.length, winRate, net, grossProfit, grossLoss, grossLossAbs, avgRR, avgPnlPercent, profitFactor };
}
export interface EquityPoint { date: string; balance: number; ts: number; }
export function equityCurve(trades: ComputedTrade[], startingBalance: number): EquityPoint[] {
  const closed = trades.filter((t) => t.status === "Closed" && t.pnlAmount !== null && t.exitDateTime)
    .slice().sort((a, b) => new Date(a.exitDateTime).getTime() - new Date(b.exitDateTime).getTime());
  let bal = startingBalance;
  const points: EquityPoint[] = [{ date: "Start", balance: bal, ts: 0 }];
  closed.forEach((t) => { bal += t.pnlAmount as number; points.push({ date: fmtDate(t.exitDateTime), balance: Math.round(bal * 100) / 100, ts: new Date(t.exitDateTime).getTime() }); });
  return points;
}
export function maxDrawdown(points: EquityPoint[]): { maxDD: number; maxDDPct: number } {
  let peak = -Infinity, maxDD = 0, maxDDPct = 0;
  points.forEach((p) => {
    peak = Math.max(peak, p.balance);
    const dd = peak - p.balance;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
    if (ddPct > maxDDPct) maxDDPct = ddPct;
  });
  return { maxDD, maxDDPct };
}
export function consecutiveStreaks(trades: ComputedTrade[]): { maxWin: number; maxLoss: number; currentWin: number; currentLoss: number } {
  const closed = trades.filter((t) => t.status === "Closed" && t.result && t.result !== "breakeven" && t.exitDateTime)
    .slice().sort((a, b) => new Date(a.exitDateTime).getTime() - new Date(b.exitDateTime).getTime());
  let curWin = 0, curLoss = 0, maxWin = 0, maxLoss = 0;
  closed.forEach((t) => {
    if (t.result === "win") { curWin += 1; curLoss = 0; } else { curLoss += 1; curWin = 0; }
    maxWin = Math.max(maxWin, curWin); maxLoss = Math.max(maxLoss, curLoss);
  });
  return { maxWin, maxLoss, currentWin: curWin, currentLoss: curLoss };
}
// Risk-adjusted return: daily returns are each day's net P&L as a fraction of
// starting balance, annualized with sqrt(252) trading days (standard convention).
export function sharpeSortino(dailyPnls: number[], startingBalance: number): { sharpe: number | null; sortino: number | null } {
  if (!dailyPnls.length || !startingBalance) return { sharpe: null, sortino: null };
  const returns = dailyPnls.map((p) => p / startingBalance);
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length;
  const stdev = Math.sqrt(variance);
  const downside = returns.filter((v) => v < 0);
  const downsideVar = downside.length ? downside.reduce((s, v) => s + v * v, 0) / downside.length : 0;
  const downsideDev = Math.sqrt(downsideVar);
  const sharpe = stdev > 0 ? (mean / stdev) * Math.sqrt(252) : null;
  const sortino = downsideDev > 0 ? (mean / downsideDev) * Math.sqrt(252) : null;
  return { sharpe, sortino };
}

/* ============================================================================
   TRADE FORM SHAPES
============================================================================ */
export const emptyTrade = (defaults: Record<string, unknown> = {}): Trade => ({
  id: "", accountId: (defaults.accountId as string) || DEFAULT_ACCOUNT_ID,
  symbol: (defaults.symbol as string) || "", marketType: (defaults.marketType as string) || "Crypto", direction: "Long",
  entryPrice: "", stopLoss: "", takeProfit: "", exitPrice: "",
  entryDateTime: "", exitDateTime: "", riskAmount: (defaults.riskAmount as string) || "",
  // fees is the total, and stays the field of record so a journal written here
  // is still readable by a build that never knew the split. commission + swap
  // are what the form edits; computeTrade sums them back into the total.
  positionSize: "", fees: "", commission: "", swap: "",
  // Optional fill legs. Empty means a plain one-in-one-out trade, which is the
  // shape every trade written before scaling existed already has.
  entries: [], exits: [],
  notes: "", status: "Open", grade: "B",
  strategy: (defaults.strategy as string) || "", screenshots: [],
  tags: [], checklist: {}, mae: "", mfe: "",
});
export const emptyLeg = (): FillLeg => ({ id: uid("LEG"), price: "", qty: "", datetime: "" });

/* Keep the plain price/size/date fields in step with the fill legs that produced
   them. The legs are the source of truth, but mirroring their aggregate back
   onto the flat fields means everything that never heard of legs — validation,
   the CSV export, an older build reading this journal — still sees a coherent
   trade. Risk follows the real size, so scaling in re-prices the risk too. */
export function withDerivedFills(form: Trade): Trade {
  const entryFill = aggregateLegs(form.entries);
  const exitFill = aggregateLegs(form.exits);
  const next = { ...form };
  if (entryFill) {
    next.entryPrice = String(round(entryFill.avgPrice, 8));
    next.positionSize = String(round(entryFill.qty, 8));
    if (entryFill.firstAt) next.entryDateTime = entryFill.firstAt;
  }
  if (exitFill) {
    next.exitPrice = String(round(exitFill.avgPrice, 8));
    if (exitFill.lastAt) next.exitDateTime = exitFill.lastAt;
  }
  const entry = num(next.entryPrice), stop = num(next.stopLoss);
  const stopDistance = (entry !== null && stop !== null && entry !== stop) ? Math.abs(entry - stop) : null;
  if (stopDistance && entryFill) next.riskAmount = String(round(entryFill.qty * stopDistance, 2));
  return next;
}

/* Load a stored trade into the form's shape. Two things need repairing on the
   way in: a trade older than the fee split carries its whole cost in `fees`,
   which is put under commission so the total survives the round-trip rather
   than being silently zeroed by two empty split fields; and legs need stable
   ids, since a restored backup's legs are plain price/qty objects with none. */
export function tradeToForm(trade: Partial<ComputedTrade>, accounts: Account[] | undefined): Trade {
  const base = emptyTrade();
  const f = { ...base, ...stripComputed(trade) };
  f.entries = (Array.isArray(trade.entries) ? trade.entries : []).map((l) => ({ ...emptyLeg(), ...l, id: l.id || uid("LEG") }));
  f.exits = (Array.isArray(trade.exits) ? trade.exits : []).map((l) => ({ ...emptyLeg(), ...l, id: l.id || uid("LEG") }));
  const hasSplit = num(trade.commission) !== null || num(trade.swap) !== null;
  if (!hasSplit && num(trade.fees) !== null) { f.commission = String(num(trade.fees)); f.swap = ""; }
  if (accounts?.length && !accounts.some((a) => a.id === f.accountId)) f.accountId = accounts[0].id;
  return f;
}

/* Sanity checks on a trade's price levels and times — the mistakes that save
   fine and then quietly poison the stats: a stop on the wrong side of entry
   computes a negative risk distance and garbage RR, a wrong-side take profit a
   negative expected RR, an exit before the entry a "—" duration. None of these
   is necessarily wrong (a stop moved to lock in profit sits "wrong side" on
   purpose), so these are warnings for the form to show, never save blockers. */
export function tradeWarnings(t: Partial<Trade> | undefined): string[] {
  const warnings: string[] = [];
  const entry = num(t?.entryPrice), stop = num(t?.stopLoss), tp = num(t?.takeProfit);
  const short = t?.direction === "Short";
  if (entry !== null && stop !== null && stop !== entry) {
    if (!short && stop > entry) warnings.push("Stop loss is above the entry on a Long — as a protective stop it would trigger immediately.");
    if (short && stop < entry) warnings.push("Stop loss is below the entry on a Short — as a protective stop it would trigger immediately.");
  }
  if (entry !== null && tp !== null && tp !== entry) {
    if (!short && tp < entry) warnings.push("Take profit is below the entry on a Long — expected RR will be negative.");
    if (short && tp > entry) warnings.push("Take profit is above the entry on a Short — expected RR will be negative.");
  }
  if (t?.entryDateTime && t?.exitDateTime) {
    const a = new Date(t.entryDateTime).getTime();
    const b = new Date(t.exitDateTime).getTime();
    if (Number.isFinite(a) && Number.isFinite(b) && b < a) warnings.push("Exit time is before the entry time — duration and time-of-day charts will ignore this trade.");
  }
  return warnings;
}

/* Stand-in for the form's contents, used to detect unsaved edits. Screenshots
   are full-quality base64, so serialising them just to answer "did anything
   change?" would chew through megabytes every time the form is closed. Their
   identity is captured by id and stage instead — an image is never edited in
   place, a replacement always arrives with a fresh id. */
export function formSignature(f: Omit<Trade, "screenshots"> & { screenshots?: { id: string; stage: string }[] }): string {
  return JSON.stringify({ ...f, screenshots: (f.screenshots || []).map((s) => `${s.id}:${s.stage}`) });
}
