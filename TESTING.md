# Testing

```bash
npm test                            # whole suite, once
npm run test:watch                  # re-run on save
npm run test:coverage               # whole suite + coverage report (text/html/lcov)
npx vitest run -t "aggregateLegs"   # one test or describe block, matched by name
npx vitest run src/lib/trade.test.js
```

Runner is [vitest](https://vitest.dev). No config file — vitest reads `vite.config.js`, so `__APP_VERSION__` and the React plugin apply automatically. Same file carries `test.coverage`.

## Coverage

`npm run test:coverage` runs the v8 provider and writes `coverage/` (gitignored — `text`/`html`/`lcov` reporters, open `coverage/index.html` for the line-by-line view). CI runs it on every push/PR as a separate step after `npm test`.

Thresholds live in `vite.config.js` (`test.coverage.thresholds`) and are scoped to `src/lib/**` — the pure-logic layer (`trade.ts`, `auth.ts`, `format.ts`), where coverage is both meaningful and achievable. `App.tsx`/`Charts.tsx` are excluded from `include` entirely: they're UI-heavy React trees already exercised by `App.test.jsx`/`App.integration.test.jsx`, not a place a blanket line-coverage number says anything useful.

`storage.ts` is inside `src/lib/` but excluded from the threshold (still shows in the text report). Unlike `trade.ts`/`auth.ts` — explicitly "no storage" per this file's own architecture — `storage.ts` *is* the storage/IPC boundary: thin pass-through to IndexedDB or `window.electronStorage` that a unit test can't exercise without reimplementing a fake IndexedDB. It's already covered end-to-end via the mocked backend in `App.integration.test.jsx`.

Current numbers on the scoped set (`trade.ts` + `auth.ts` + `format.ts` + `report.ts` + `reportchart.ts`): ~98% statements, ~91% branches, ~99% functions, 100% lines. Thresholds are set a little under that so incidental drift doesn't fail CI on unrelated PRs — a real coverage regression will still trip them.

Suites, two environments:

- `src/lib/trade.test.js` — the rules. Everything under test is pure, so it runs in plain Node: no DOM, no jsdom.
- `src/lib/format.test.js` — the display formatters. Small functions, but every figure the app and the exported reports show goes through them, and they share one contract: a missing value renders as an em dash, never `NaN` or `$null`. Also pins `round`'s half-way binary-float behaviour, which is *not* decimal rounding (`round(1.005, 2) === 1`) and must not be "fixed" — an epsilon nudge there shifts every derived P&L figure in the journal.
- `src/lib/reportchart.test.js` — the exported reports' chart primitives (SVG strings in, no DOM). Geometry stays finite and inside its viewBox, P&L keeps its colour meaning, labels are escaped, and the degenerate inputs a real journal produces (empty, single point, all-equal, all-zero) render an empty-state line rather than a broken path.
- `src/lib/report.test.js` — the report documents themselves: the chart section in each of its two renderings (real SVG for PDF/HTML, coloured table cells for Word, which drops inline SVG silently), and the whole interactive `.html` report's markup, including that every row carries the `data-*` its script sorts and filters on and that an open trade's P&L is blank rather than a zero that would outrank real losses.
- `src/lib/report.dom.test.js` — the interactive report's *behaviour*: the script that ships inside the exported file, pulled out of the document and run against jsdom the way a browser would. Search narrows, the filters compose, header clicks sort (blanks last both ways), and the count strip re-totals what is showing.
- `src/App.test.jsx` — component smoke tests (`@testing-library/react` + `user-event`) for the trade form's validation gate, the trades table, the daily journal panel (including its filter), the strategy playbook tab, the journal-timezone picker, the login gate (sign in *and* sign up) and the Profile tab. jsdom is opted into **per file** via the `// @vitest-environment jsdom` pragma at its top, so the lib suite stays in Node. Deliberately shallow: they assert the components wire the rules to the user (errors surface, saves fire, destructive paths confirm first), not the maths — that lives in the lib suite. `TradeForm`, `TradesTable`, `JournalPanel`, `PlaybookPanel`, `CashflowPanel`, `TimezonePicker`, `AuthGate` and `SettingsPanel` are exported from App.tsx for these tests only.
- `src/App.integration.test.jsx` — the one suite that renders the real default-exported `App`, not an isolated panel. `./lib/storage` is `vi.mock`ed with an in-memory `get/set/delete/list`; `./Charts` is stubbed too, so lazy-loaded Recharts components never actually mount in jsdom. Covers the wiring `App.test.jsx` structurally can't: boot reading meta + shards into the rendered UI, `writtenShardsRef` shard-diffing, the meta/trade save effects staying separate, and `loadError` disabling persistence. See "What is covered" below. It raises its own `testTimeout` to 20s via `vi.setConfig`: it is the only suite that mounts the whole app, and under `--coverage` (v8 instrumentation, other suites running alongside) a boot can pass vitest's 5s default — the work is real, not a hang.

One trap found writing the component tests: the `DateTimePicker` renders inside a `Field` `<label>`, and buttons are labelable elements — so every button in its popover inherits "Entry Date & Time" as its accessible name. Those tests query the picker by text, not by role+name.

Another: React reverts a controlled input's DOM value back to its (unchanged) `value` prop immediately after a change event, if the test's mocked `onChange`/`setState` doesn't actually update that prop. `fireEvent.change` still delivers the typed value to the handler *at dispatch time* — but a test that stores the handler's raw argument and reads `e.target.value` from it later is reading the post-revert DOM, not what was typed. Read the value inside the mock's own implementation (synchronously, during the event), not after. This is why the strategy-playbook edit test's `setSettings` mock captures its result inline rather than via `mock.calls.at(-1)`.

## Expected result

```
Tests  376 passed (376)
```

**A fully green run is the expected state.** No `BUG:`-tagged tests are outstanding — the last one (the CSV fee round trip) went green when the defect was fixed and lost its tag. Any failure is a real regression.

The `BUG:` convention stays: a test tagged `BUG:` asserts what the code *should* do against a real, documented, unfixed defect, and is red on purpose. While one is outstanding, the expected count in this section carries the failure — and a green run during that time means someone rewrote the expectation to match buggy output, which must be reverted. The suite carried 7 such failures at peak; each went green on its own when its defect was fixed, which is the intended lifecycle. See [KNOWN_ISSUES.md § Fixed](KNOWN_ISSUES.md#fixed).

## What is covered

`src/lib/trade.test.js` covers `src/lib/trade.ts` — the journal's rules — feature by feature:

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
| Timezone picker | `offsetLabelPadded` renders every offset at one fixed width (`GMT+05:30`), so the list reads as an even ladder; `timezoneOptions` sorts ascending by offset with the id as tiebreak, splits region/city (underscores gone) and drops junk ids instead of sorting `NaN`; `filterTimezoneOptions` requires *every* term to match (so "asia york" finds nothing) and accepts an offset as `gmt+5:30` / `+5:30` / `5:30` / `05:30`, an unsigned term reaching either side of the meridian; `groupTimezoneOptions` buckets one group per offset without reordering |
| Strategy performance | `strategyPerformance` summarises each name against its own trades, keeps the list order, gives an untraded strategy a row so its note still has a home, counts open trades in `total` but leaves them out of `stats`, reports the latest exit, and never folds a removed strategy's trades into another row |
| Journal (grains) | `journalEntries` orders newest first and drops blanks; **`kind`** keeps only its key shape (day/week/year), so a week note never leaks into the daily list and vice versa; markdown headings carry the period's trade count and P&L; a multi-line note round-trips through CSV quoting; `filterJournalEntries` narrows by inclusive range and case-insensitive text, and the exporters emit exactly the filtered set; `journalToHtml` escapes note free text and splits Word (Office namespaces) from PDF (`@page`) variants |
| Strategy playbook | `strategyNotes` normalized to a map of non-blank strings, junk shapes to `{}`, notes length-capped |
| Chart windows | `weeklyChartCount`/`monthlyChartCount`/`yearlyChartCount` and the trade-based `rrChartCount`/`hourChartCount`/`durationChartCount` constrained to the picker ladder (`CHART_PERIOD_CHOICES`, 0 = all), off-ladder values fall back to 5; `mostRecentTrades` returns the newest N by exit time (open trades last), the whole list unmutated when N is 0 |
| Filter chips | `describeFilters` names each active filter in a trader's words, ignores whitespace-only values, gives every chip a unique key, and carries a *patch* so a date preset drops with the range it was holding (and either end of a custom range drops the preset) |
| Day breakdown | `dayBreakdown` finds the best and worst day of a period, splits the days green/red/flat (a scratch day counting as neither), averages over *trading* days rather than calendar days, keeps the earlier of two tied days, and reports nulls — not zeroes — for a period with nothing closed in it |
| Cashflow | `normalizeTransactions` stores amounts positive and drops non-positive/unknown-type/junk rows; `transactionsNet` sums deposits up and withdrawals down; `filterTransactions` narrows by type/date range/note only; `sortedTransactions` orders newest first and resolves an orphaned `accountId` to `accounts[0]`; `mergeSettings` defaults the store to `[]` |
| Clock format | `clockFormat` constrained to `12h`/`24h`, `12h` the legacy default |
| Trade ids | high-water counter: a deleted trade's number is never reissued, the counter can't fall behind the journal |

`src/lib/auth.test.js` covers the login gate's pure logic (jsdom-free, on Node's Web Crypto): `hashPassword` never stores plaintext and is deterministic for a fixed salt but salted per call otherwise, `verifyPassword` admits the right password and rejects the wrong one, `normalizeUsers` drops records missing a username or hash, `findUser` matches case-insensitively, `makeUser` rejects blanks. The v3.5 profile fields are pinned as *additive*: a pre-profile record loads unchanged, `displayNameOf` falls back to the username, an avatar that is not a capped inline image is dropped rather than stored, `updateProfile` returns a new record and leaves untouched fields alone, and `changePassword` refuses without the current password, refuses a too-short or unchanged one, draws a fresh salt, and carries the identity and profile through.

The component smoke tests in `App.test.jsx` add the journal-timezone picker (the GMT ladder renders ascending, typing a city or an offset narrows it, Enter picks the cursor's row, System reports `""` rather than the machine's id, and a zone this runtime doesn't list stays selectable), the strategy playbook's performance row (win rate and net P&L beside each note, search over names *and* note text, sorting by result without dropping untraded strategies), the cashflow tab (records a deposit into `settings.transactions`, running balance + account-balance card, filter behind the toggle), the login gate (`AuthGate` rejects a wrong password / unknown username, admits the right one), the trades table's ServiceNow-style inline edit (the grade cell's pencil commits `{grade}` through `onBulkEdit`, a symbol edit commits upper-cased on Enter, and no pencil renders when `onBulkEdit` is absent) and `ErrorBoundary` (a throwing child renders the fallback screen and logs via `console.error` rather than crashing; a non-throwing child renders normally).

`App.integration.test.jsx` covers the persistence wiring around the root `App` itself, against a mocked `./lib/storage`: a trade seeded into its shard (plus a meta-seeded strategy) renders on the Trades and Playbook tabs after boot; editing one trade's grade through the inline pencil writes exactly one shard key (`writtenShardsRef` diffing) and no meta write; switching tabs (a `preferences` change) writes meta but no trade shard, pinning that the two save effects are genuinely separate; and a `storage.list` rejection during boot shows the `loadError` fallback screen and leaves every write disabled — the shard already on disk is provably untouched afterwards. The charts and the Electron layer still have no automated tests — verify those by driving the app.

## The suite is pinned to `TZ=Asia/Kolkata`

Both test scripts run through `cross-env TZ=Asia/Kolkata`. Two reasons:

1. **Determinism.** Date assertions otherwise depend on whoever's machine runs them.
2. **It is the timezone this journal is actually kept in**, and the one the day-bucketing bugs bit in. On a UTC machine those tests all pass against the *broken* code, which is exactly how the defect survived as long as it did: `isoDate()` returned a UTC day while every caller handed it a Date built from local parts, and at UTC+0 the two agree.

The bugs are fixed; **keep the pin**. It is now the only thing standing between the fix and a silent regression — unpin it, and reverting `isoDate` to `toISOString()` goes green again.

## Conventions

- **New rules go in `lib/trade.ts` with a test.** Not in App.tsx. If logic is pure, it belongs where it can be tested.
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
