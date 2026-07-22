# Testing

```bash
npm test                            # whole suite, once
npm run test:watch                  # re-run on save
npx vitest run -t "aggregateLegs"   # one test or describe block, matched by name
npx vitest run src/lib/trade.test.js
```

Runner is [vitest](https://vitest.dev). No config file — vitest reads `vite.config.js`, so `__APP_VERSION__` and the React plugin apply automatically.

Two suites, two environments:

- `src/lib/trade.test.js` — the rules. Everything under test is pure, so it runs in plain Node: no DOM, no jsdom.
- `src/App.test.jsx` — component smoke tests (`@testing-library/react` + `user-event`) for the trade form's validation gate, the trades table, the daily journal panel (including its filter) and the strategy playbook tab. jsdom is opted into **per file** via the `// @vitest-environment jsdom` pragma at its top, so the lib suite stays in Node. Deliberately shallow: they assert the components wire the rules to the user (errors surface, saves fire, destructive paths confirm first), not the maths — that lives in the lib suite. `TradeForm`, `TradesTable`, `JournalPanel`, `PlaybookPanel` and `SettingsPanel` are exported from App.jsx for these tests only.

One trap found writing the component tests: the `DateTimePicker` renders inside a `Field` `<label>`, and buttons are labelable elements — so every button in its popover inherits "Entry Date & Time" as its accessible name. Those tests query the picker by text, not by role+name.

Another: React reverts a controlled input's DOM value back to its (unchanged) `value` prop immediately after a change event, if the test's mocked `onChange`/`setState` doesn't actually update that prop. `fireEvent.change` still delivers the typed value to the handler *at dispatch time* — but a test that stores the handler's raw argument and reads `e.target.value` from it later is reading the post-revert DOM, not what was typed. Read the value inside the mock's own implementation (synchronously, during the event), not after. This is why the strategy-playbook edit test's `setSettings` mock captures its result inline rather than via `mock.calls.at(-1)`.

## Expected result

```
Tests  244 passed (244)
```

**A fully green run is the expected state.** No `BUG:`-tagged tests are outstanding — the last one (the CSV fee round trip) went green when the defect was fixed and lost its tag. Any failure is a real regression.

The `BUG:` convention stays: a test tagged `BUG:` asserts what the code *should* do against a real, documented, unfixed defect, and is red on purpose. While one is outstanding, the expected count in this section carries the failure — and a green run during that time means someone rewrote the expectation to match buggy output, which must be reverted. The suite carried 7 such failures at peak; each went green on its own when its defect was fixed, which is the intended lifecycle. See [KNOWN_ISSUES.md § Fixed](KNOWN_ISSUES.md#fixed).

## What is covered

`src/lib/trade.test.js` covers `src/lib/trade.js` — the journal's rules — feature by feature:

| Area | What is pinned |
|---|---|
| P&L and RR | both directions, win/loss/breakeven, open trades earning nothing, no RR without risk distance |
| Fees | commission+swap split, blank half as zero, pre-split `fees` as total, split outranking a stale total |
| Fill legs | size-weighted average, bad legs skipped, matched-quantity P&L, `_openQty`, leg timestamps as the real open/close |
| Accounts | the `acct-main` legacy fold, balance mirroring, never-empty list, dangling ids healed |
| Preferences | defaults, the flat→nested calendar lift, filter backfill, zoom clamped to the ladder, density coerced to its two values, hiddenColumns kept a clean string array, accent through `normalizeAccent` (only `#rrggbb` survives) |
| Branding | journal name/tagline trimmed and length-capped, non-strings coerced to empty, empty default |
| UI zoom | ladder stepping up/down, clamped at both ends, off-ladder factors snapped before stepping |
| Command palette | token-AND matching in any order, case-insensitive, word-start ranked over mid-word, caller-order tie-break, limit, junk items tolerated |
| Sharding | determinism, range, spread, key naming |
| CSV | quoting/escaping/newlines, MT4 alias mapping, enum rejection, export→import round trip |
| Stats | summarize, equity curve, drawdown, streaks, sharpe/sortino, groupPerformance, goals |
| Form | `tradeToForm` repairs, `withDerivedFills` mirroring, `formSignature` dirty-checking |
| Dates | duration, ISO week/month keys, ranges, presets |
| Day keys | `isoDate` answers the **local** day — early-morning trades, local midnight, calendar cell keys, preset boundaries |
| Journal timezone | `zonedNow` reads another zone's wall clock (EST and EDT), lands "today" on the journal zone's day when it differs from the machine's, `""`/unknown ids fall back to the machine, `mergeSettings` defaults pre-timezone journals to `""` and drops invalid ids; `tzOffsetLabel` tracks DST and half-hour offsets; `tzOffsetMinutes` exposes the raw offset (the Settings picker sorts by it, west→east) and is `NaN` for junk |
| Journal (grains) | `journalEntries` orders newest first and drops blanks; **`kind`** keeps only its key shape (day/week/year), so a week note never leaks into the daily list and vice versa; markdown headings carry the period's trade count and P&L; a multi-line note round-trips through CSV quoting; `filterJournalEntries` narrows by inclusive range and case-insensitive text, and the exporters emit exactly the filtered set; `journalToHtml` escapes note free text and splits Word (Office namespaces) from PDF (`@page`) variants |
| Strategy playbook | `strategyNotes` normalized to a map of non-blank strings, junk shapes to `{}`, notes length-capped |
| Chart windows | `weeklyChartCount`/`monthlyChartCount`/`yearlyChartCount` and the trade-based `rrChartCount`/`hourChartCount`/`durationChartCount` constrained to the picker ladder (`CHART_PERIOD_CHOICES`, 0 = all), off-ladder values fall back to 5; `mostRecentTrades` returns the newest N by exit time (open trades last), the whole list unmutated when N is 0 |
| Cashflow | `normalizeTransactions` stores amounts positive and drops non-positive/unknown-type/junk rows; `transactionsNet` sums deposits up and withdrawals down; `filterTransactions` narrows by type/date range/note only; `sortedTransactions` orders newest first and resolves an orphaned `accountId` to `accounts[0]`; `mergeSettings` defaults the store to `[]` |
| Clock format | `clockFormat` constrained to `12h`/`24h`, `12h` the legacy default |
| Trade ids | high-water counter: a deleted trade's number is never reissued, the counter can't fall behind the journal |

`src/lib/auth.test.js` covers the login gate's pure logic (jsdom-free, on Node's Web Crypto): `hashPassword` never stores plaintext and is deterministic for a fixed salt but salted per call otherwise, `verifyPassword` admits the right password and rejects the wrong one, `normalizeUsers` drops records missing a username or hash, `findUser` matches case-insensitively, `makeUser` rejects blanks.

The component smoke tests in `App.test.jsx` add the cashflow tab (records a deposit into `settings.transactions`, running balance + account-balance card, filter behind the toggle), the login gate (`AuthGate` rejects a wrong password / unknown username, admits the right one), the trades table's ServiceNow-style inline edit (the grade cell's pencil commits `{grade}` through `onBulkEdit`, a symbol edit commits upper-cased on Enter, and no pencil renders when `onBulkEdit` is absent) and `ErrorBoundary` (a throwing child renders the fallback screen and logs via `console.error` rather than crashing; a non-throwing child renders normally). The React shell's remaining wiring, the charts and the Electron layer have no automated tests — verify those by driving the app.

## The suite is pinned to `TZ=Asia/Kolkata`

Both test scripts run through `cross-env TZ=Asia/Kolkata`. Two reasons:

1. **Determinism.** Date assertions otherwise depend on whoever's machine runs them.
2. **It is the timezone this journal is actually kept in**, and the one the day-bucketing bugs bit in. On a UTC machine those tests all pass against the *broken* code, which is exactly how the defect survived as long as it did: `isoDate()` returned a UTC day while every caller handed it a Date built from local parts, and at UTC+0 the two agree.

The bugs are fixed; **keep the pin**. It is now the only thing standing between the fix and a silent regression — unpin it, and reverting `isoDate` to `toISOString()` goes green again.

## Conventions

- **New rules go in `lib/trade.js` with a test.** Not in App.jsx. If logic is pure, it belongs where it can be tested.
- **Test names read as claims about the product**, not about the function ("realises P&L only on the size that both entered and left", not "computeTrade returns _qty"). A failure should tell you what broke for the trader.
- **Tests named for a legacy fallback are load-bearance checks.** If "folds a pre-accounts journal into one account…" goes red, a real 2.x journal on disk just stopped loading. Do not delete it to get green.
- **Comment the arithmetic** where an expected value isn't self-evident (`expect(t.pnlPercent).toBe(10); // 20 / (100 * 2) * 100`).
- `baseTrade(overrides)` at the top of the file builds a closed long — in at 100, out at 110, 2 units, stop 95, target 120. Override it rather than hand-rolling trade objects.

## Adding a test

```js
import { describe, it, expect } from "vitest";
import { yourFn } from "./trade";
```

Vitest globals are **not** enabled — import `describe`/`it`/`expect` explicitly. That keeps eslint honest, since the flat config only declares browser globals.
