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
| `npm run lint` | eslint |
| `npm test` | vitest — fully green expected, see below |
| `npm run test:watch` | vitest, re-running on save |

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
- **Analytics** — equity curve, drawdown, daily/monthly P&L, win/loss split, R distribution, hour-of-day and day-of-week performance, duration histogram, MAE/MFE scatter, per-symbol and per-strategy tables.
- **Calendar** — daily/weekly/monthly P&L heatmap with per-day notes.
- **Goals** — balance, weekly/monthly/yearly profit, win rate, profit factor, average R, max daily loss.
- **Import** — CSV from MT4/MT5, Binance and TradingView, mapped by column aliases.
- **Export** — CSV, Excel, Word, JSON backup, and PDF reports (a real PDF on desktop; the print dialog on web).
- **12 themes**, light and dark — plus a custom accent colour and a Comfortable/Compact density toggle.
- **Your table, your columns** — hide any trades-table column you don't use; the choice persists.
- **Personalisation** — name the journal (and its tagline) yourself in Settings → About; the sidebar, window title and report headers follow.
- **Keyboard-first** — Ctrl+N new trade, Ctrl+1–6 tab jumps, Alt+←/→ history, Ctrl +/−/0 UI zoom, J/K + Enter/E/X to drive the trades table; press `?` for the full list.
- **Command palette** — Ctrl+K: fire any action, jump to any tab, switch theme, or pull up any trade by symbol, id, strategy or tag.

## Testing

```bash
npm test
```

Expected: **`146 passed (146)`** — fully green.

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

React 19 · Vite 8 · Recharts · Electron 43 · electron-builder · vitest. No CSS framework — themes are CSS custom properties injected per theme.

New rules belong in `src/lib/trade.js` with a test. `src/App.jsx` is the React shell; anything pure that lands there can't be tested.
