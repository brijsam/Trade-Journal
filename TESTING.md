# Testing

```bash
npm test                            # whole suite, once
npm run test:watch                  # re-run on save
npx vitest run -t "aggregateLegs"   # one test or describe block, matched by name
npx vitest run src/lib/trade.test.js
```

Runner is [vitest](https://vitest.dev). No config file — vitest reads `vite.config.js`, so `__APP_VERSION__` and the React plugin apply automatically. No jsdom and no `@testing-library`: everything under test is pure, so the tests run in plain Node.

## Expected result

```
Tests  151 passed (151)
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
| Trade ids | high-water counter: a deleted trade's number is never reissued, the counter can't fall behind the journal |

The React shell (`App.jsx`), the charts and the Electron layer have no automated tests. Verify those by driving the app.

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
