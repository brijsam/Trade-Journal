# Brij Trade Journal

A local-first trading performance journal for crypto, forex, commodities, stocks and futures.

Log trades with entries, exits, stops and targets; scale in and out with individual fill legs; grade setups against a checklist; attach chart screenshots; and read the results back as equity curves, drawdown, R-multiples, win rate, profit factor, Sharpe/Sortino, and per-symbol, per-strategy, per-hour and per-weekday breakdowns.

**Your data never leaves your machine.** There is no backend, no account, and no network call at runtime. The desktop app works entirely offline.

## Running it

```bash
npm install
npm run dev            # browser at :5173 — data in IndexedDB
npm run electron:dev   # desktop shell — data in real files, native Save As
```

| Script | Does |
|---|---|
| `npm run dev` | Vite dev server on :5173 |
| `npm run electron:dev` | dev server + Electron shell |
| `npm run build` | production web build → `dist/` |
| `npm run dist` | build + package the Windows installer → `release/*.exe` |
| `npm run lint` | eslint + `tsc --noEmit` |
| `npm run typecheck` | `tsc --noEmit` alone |
| `npm test` | vitest — fully green expected, see below |
| `npm run test:watch` | vitest, re-running on save |
| `npm run test:coverage` | vitest + coverage report, thresholds scoped to `src/lib/**` |

## Where your data lives

Desktop:

```
%APPDATA%\tradingjournal\storage\
```

One JSON file per key — trade shards, one per trade's screenshots, and a settings record. Back that folder up like any other important local folder, or use **Settings → Download Backup** for a portable copy.

In the browser build the same data sits in IndexedDB under `brij-trade-journal`.

## Features

- **Accounts** — multiple accounts/portfolios each with a starting balance, viewed one at a time or pooled.
- **Fill legs** — scale in and out; P&L is realised only on matched quantity, and the rest stays open.
- **Fees** — commission and swap tracked apart, totalled automatically.
- **Journalling** — notes, tags, A+→D grading, a per-trade rule checklist, MAE/MFE, and screenshots staged by Before Entry / During Trade / Exit.
- **Journal (daily / weekly / yearly)** — free-text notes at three grains, each with its own filter and Markdown / CSV / Word / PDF export; the daily grain is shared with the calendar's day notes.
- **Playbook** — write each strategy down (setup, trigger, invalidation, sizing) on its own tab, with that strategy's real record beside it — trades, win rate, net P&L, average R, profit factor, last close. Search names and note text, sort by result. A note survives the strategy being renamed away and back.
- **Cashflow** — record deposits and withdrawals per account with a running balance and its own filter; the account balance = starting balance + trade P&L + net cashflow.
- **Trades table** — a totals row for whatever the filter selected (net P&L, win rate, average R), a chip per active filter that removes just that one, a header that stays put while you scroll, and how long each open trade has been open.
- **Inline list edit** — hover a trades-table row and edit Symbol, Market, Direction, Grade or Status right in the cell (ServiceNow-style), without opening the form.
- **Analytics** — equity curve, drawdown, daily/monthly P&L, win/loss split, R distribution, hour-of-day and day-of-week performance, duration histogram, MAE/MFE scatter, per-symbol and per-strategy tables; the period and trade-based charts window to the most recent N (set per chart, 5 by default).
- **Calendar** — daily/weekly/monthly/yearly P&L heatmap with per-day notes, a week-total column beside every row, best/worst day and green-vs-red day counts, a Today jump, and a legend that says what the shading is worth. Click a month in the yearly grid to open it; click a day with no trades to write its note.
- **Goals** — balance, weekly/monthly/yearly profit, win rate, profit factor, average R, max daily loss.
- **Import** — CSV from MT4/MT5, Binance and TradingView, mapped by column aliases.
- **Export** — CSV, Excel, Word, JSON backup, PDF reports (a real PDF on desktop; the print dialog on web), and a self-contained **interactive HTML report**: equity curve, monthly and per-strategy P&L, win/loss split, and a trade table you can search, filter and sort. Every format carries charts; the file opens in any browser, offline, with nothing to install.
- **Login gate (optional)** — set a username and password in Settings → Security to keep a casual second person out of the running app, then sign in from a gate that also offers **Create account** (self sign-up is off by default — turn it on for a shared machine). Multi-user aware; passwords are hashed, never stored in the clear. It guards the app, not the files on disk — not disk encryption.
- **Profile** — your own page once signed in: photo or initials, display name, member since, last sign-in, password change and sign out. The name in the top bar opens it.
- **Help** — an in-app About / per-tab guides / keyboard-shortcuts / privacy tab, showing the current version.
- **12 themes**, light and dark — plus a custom accent colour and a Comfortable/Compact density toggle.
- **Your table, your columns** — hide any trades-table column you don't use; the choice persists.
- **Personalisation** — name the journal (and its tagline) yourself in Settings → About; the sidebar, window title and report headers follow.
- **Journal timezone** — pin the journal to the session you trade (Settings → About). "Today", the date presets, the calendar highlight and the clock follow it; your trade times are never rewritten. The picker searches ~400 zones by city, region or GMT offset, laid out as an ascending `+HH:MM GMT` ladder (+01:00, +01:30, +02:00 …), and the list follows the field instead of being cut off at the bottom of the page.
- **Keyboard-first** — Ctrl+N new trade, Ctrl+1–9 tab jumps, Alt+←/→ history, Ctrl +/−/0 UI zoom, J/K + Enter/E/X to drive the trades table; press `?` for the full list. Visible focus rings throughout, a skip-to-content link, sortable headers you can reach with Tab and sort with Enter.
- **Command palette** — Ctrl+K: fire any action, jump to any tab, switch theme, or pull up any trade by symbol, id, strategy or tag.

## Testing

```bash
npm test
```

Expected: **`376 passed (376)`** — fully green.

When a live defect is on the books it is pinned by a red test tagged `BUG:` that asserts what the app *should* do; [KNOWN_ISSUES.md](KNOWN_ISSUES.md) and [TESTING.md](TESTING.md) then carry the expected failure count. None are outstanding right now, so any failure is a genuine regression.

The suite is pinned to `TZ=Asia/Kolkata` on purpose. See [TESTING.md](TESTING.md).

## Documentation

| Doc | For |
|---|---|
| [CLAUDE.md](CLAUDE.md) | working in this repo with Claude Code — commands, layout, invariants |
| [ARCHITECTURE.md](ARCHITECTURE.md) | storage, sharding, the v3 data model and its legacy fallbacks |
| [TESTING.md](TESTING.md) | how the suite is built, the `BUG:` convention, the timezone pin |
| [KNOWN_ISSUES.md](KNOWN_ISSUES.md) | live defects with fix sketches — **read before touching dates or CSV** |
| [RELEASING.md](RELEASING.md) | version bumps, packaging, the fields that must not change |
| [ELECTRON_SETUP.md](ELECTRON_SETUP.md) | historical — one-time notes for adding the Electron shell, already done |

## Stack

React 19 · Vite 8 · Recharts · Electron 43 · electron-builder · vitest · TypeScript (`strict: true`, whole app — see CLAUDE.md § Type safety). No CSS framework — themes are CSS custom properties injected per theme.

New rules belong in `src/lib/trade.ts` with a test. `src/App.tsx` is the React shell; anything pure that lands there can't be tested.

## License

All rights reserved — see [LICENSE](LICENSE). Not open-source; no permission is granted to use, copy, modify or redistribute this software without the copyright holder's written consent.
