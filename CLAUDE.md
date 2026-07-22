# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Trade Journal (display name; the repo keeps its original folder/package identity) — a local-first trading performance journal (crypto, forex, commodities, stocks, futures). It ships two ways from one codebase: a Vite/React web build, and a packaged Windows desktop app (Electron + NSIS installer). There is no backend and no network calls; the packaged app must work fully offline.

Deeper references, all in the repo root: [ARCHITECTURE.md](ARCHITECTURE.md) (data model and storage in full), [TESTING.md](TESTING.md) (how the suite is built and why it is pinned to IST), [RELEASING.md](RELEASING.md) (packaging rules), [KNOWN_ISSUES.md](KNOWN_ISSUES.md) (live defects, plus the fixed ones worth not re-introducing — **read before touching date handling or CSV**).

## Commands

```bash
npm run dev            # Vite dev server on :5173 (browser build, IndexedDB storage)
npm run electron:dev   # dev server + Electron shell (file storage, native Save As)
npm run build          # vite build -> dist/
npm run dist           # vite build + electron-builder -> release/*.exe
npm run lint           # eslint (flat config) + tsc --noEmit
npm run typecheck      # tsc --noEmit alone
npm test               # vitest run, pinned to TZ=Asia/Kolkata
npm run test:watch     # vitest watch
npx vitest run -t "aggregateLegs"   # single test or describe block, by name
```

Verification for any change is `npm run lint` + `npm test`, plus driving the app when the change is visual (`.claude/launch.json` defines the dev server as "Trading Journal Dev" on port 5173).

**`npm test` is expected to be fully green (248 passed).** No `BUG:`-tagged known-failing tests are outstanding — the CSV fee round-trip defect that used to hold the count at 1 failure is fixed. If a future defect lands a new `BUG:` test, [TESTING.md](TESTING.md) and [KNOWN_ISSUES.md](KNOWN_ISSUES.md) carry the expected count; a `BUG:` test must never be made green by rewriting its expectation. Any failure today is a real regression.

## Layout

- `src/lib/trade.ts` — **the journal's rules.** Trade maths, aggregate stats, date bucketing, storage sharding, account/settings normalization, CSV import/export, cashflow transactions, form shapes. Pure: no React, no DOM, no storage. This is where behaviour changes belong. Domain types (`Trade`, `ComputedTrade`, `Settings`, `Preferences`, `Account`, `Transaction`, …) live at the top of this file and are imported by `auth.ts` and `App.tsx` alike (see § Type safety below).
- `src/lib/trade.test.js` — the feature suite covering the above (plain Node, no DOM; stays `.js` — it's driving already-typed exports, not adding types of its own).
- `src/lib/auth.ts` — the local login gate's pure logic: PBKDF2-SHA-256 password hashing on Web Crypto (`globalThis.crypto.subtle`, present in the browser, the Electron renderer and Node's test runtime), user-record normalization and lookup. No React, no DOM, no storage. Covered by `src/lib/auth.test.js`.
- `src/App.test.jsx` — component smoke tests for the trade form's validation gate, the trades table, the journal panel, the strategy playbook, the cashflow tab, the login gate and the render-level `ErrorBoundary` (jsdom via per-file pragma; the lib suite stays DOM-free). `TradeForm`, `TradesTable`, `JournalPanel`, `PlaybookPanel`, `CashflowPanel`, `HelpPanel`, `AuthGate`, `SettingsPanel` and `ErrorBoundary` are exported from App.tsx for these tests only. This test file itself stays `.jsx` — it drives already-typed exports rather than adding types of its own.
- `src/App.integration.test.jsx` — drives the real default-exported `App` against an in-memory mock of `./lib/storage` (`./Charts` is stubbed too, so Recharts never loads in jsdom). Covers the boot-to-render loop and the save wiring that `App.test.jsx`'s isolated panels can't reach: meta+shard reads landing in the UI, `writtenShardsRef` shard-diffing (one edit writes one shard key, not all 24), the meta/trade save effects staying genuinely separate, and `loadError` disabling persistence so a failed read never overwrites shards already on disk.
- `src/lib/format.ts` — pure display formatting shared by both bundles.
- `src/lib/storage.ts` — the storage backend switch, typed `Storage` interface (`get/set/delete/list`).
- `src/App.tsx` (~5.3k lines) — the React shell: design tokens, CSS, every panel and modal, and the root `App` component. Sections are marked with `/* ==== NAME ==== */` banners; grep those to navigate. List-scale code paths (e.g. the trades table sort) derive per-row keys once and keep comparators free of per-comparison parsing — hold that line when touching them.
- `src/Charts.tsx` — every Recharts component, loaded via `React.lazy` (`lazyChart()` in App.tsx) so ~300kB of charting stays out of the initial bundle.
- `electron/main.cjs` / `electron/preload.cjs` — desktop shell: storage IPC, export dialogs, window state. The renderer runs with `sandbox: true`: `preload.cjs` may only use `contextBridge` + `ipcRenderer` — requiring any other Node module there breaks under sandbox. New desktop capability = new `ipcMain.handle` in main.cjs. Still plain `.cjs` — a separate CommonJS/Node program, not part of the Vite/React `tsconfig.json`.

**Import direction is one-way: `App.tsx` → `lib/*`.** `Charts.tsx`, `lib/format.ts` and `lib/trade.ts` must never import `App.tsx` — that circular import drags the whole app into the lazy chart chunk and defeats the code split. Enforced by a `no-restricted-imports` rule in `eslint.config.js`, which applies to `lib/**/*.ts` the same as `.js`/`.jsx`.

New pure logic goes in `lib/trade.ts` with a test, not in App.tsx. Anything touching `window`, `document` or `storage` stays in App.tsx.

### Type safety

The whole Vite/React app is real TypeScript now (batch #4 of [UPGRADES.md](UPGRADES.md), done in two sessions): `src/lib/*.ts` (`trade.ts`, `auth.ts`, `format.ts`, `storage.ts`) first, then `App.jsx` → `App.tsx` and `Charts.jsx` → `Charts.tsx`. `strict: true` throughout, checked by `tsc --noEmit` (chained into `npm run lint`, and its own `npm run typecheck`). No import-path changes were needed anywhere: this codebase already imports extension-less (`from "./lib/trade"`, `from "./App"`), which resolves identically regardless of `.ts`/`.tsx`/`.js`/`.jsx`. `main.jsx` and both test files (`App.test.jsx`, `App.integration.test.jsx`, plus the two `lib/*.test.js`) deliberately stay plain JS — `tsconfig.json`'s `allowJs: true, checkJs: false` keeps them in the program (imports resolve, IDE intellisense works off the typed exports they import) without requiring them typed.

Boundary functions that exist specifically to coerce "whatever's on disk" — `mergeSettings`, `mergePreferences`, `normalizeAccounts`, `normalizeUsers`, `rowsToTrades`, `computeTrade`'s input — take `unknown`/loose input on purpose and return one of the domain types (`Trade`, `ComputedTrade`, `Settings`, `Preferences`, `Account`, `AuthUser`, …) defined at the top of `trade.ts` / `auth.ts`. That is intentional, not a gap: the whole point of those functions is "accept anything, guarantee a shape coming out." Don't tighten their parameter types to the domain types themselves — that would just move the `as`-casting into every call site instead of the one function whose job is to absorb it. `App.tsx` follows the same stance in a few of its own inherently-dynamic spots (a generic per-field form setter keyed by a runtime string, Recharts' custom render-prop callbacks in `Charts.tsx`) via a local `type Any = any` alias — named rather than bare `any` so it reads as a deliberate boundary, not a miss.

Two type-collapse traps hit repeatedly during the migration, worth knowing before extending these types further: intersecting a type with `{ screenshots: ShotDraft[] }` when the base type already declares `screenshots?: unknown[]` does **not** override the property — TS intersects the two property types instead, collapsing to something unusable. `Omit<Trade, "screenshots"> & { screenshots: ShotDraft[] }` is the fix (see `FormTrade`, `formSignature`'s parameter type). And `num()`/`round()` in `format.ts` are overloaded so a literal numeric fallback (`num(x, 0)`) narrows the return to `number` instead of `number | null` — without the overload, every `num(x, 0)` call site would need its own null-check for a null the fallback already ruled out.

`src/vite-env.d.ts` carries the ambient declarations this migration needed: `__APP_VERSION__` (Vite's `define`) and `Window.electronStorage` / `Window.desktopExport` / `Window.desktopZoom` (the three globals `electron/preload.cjs` exposes via `contextBridge` — present only inside Electron, feature-detected everywhere they're read).

## Architecture

Summarised here; [ARCHITECTURE.md](ARCHITECTURE.md) has the full detail.

### Storage: one interface, two backends

`src/lib/storage.ts` exports `storage` with `get/set/delete/list`, all promise-returning. Inside Electron it routes to `window.electronStorage` (exposed by `preload.cjs`, handled in `main.cjs`, one JSON file per key under `%APPDATA%\tradingjournal\storage`). In a plain browser it falls back to IndexedDB. App code never branches on which is active.

Main-process writes are temp-file + atomic `rename`, and all fs calls are async — the sync versions stalled the main thread on every save. Values are written verbatim as the JSON string the renderer built; files starting with `{"value":"` are a legacy wrapper that `unwrapStored()` still reads and that is dropped on the next save of that key.

### Sharded trade persistence

Trades are split across `SHARD_COUNT = 24` keys (`brij-tj-shard-<n>`) by `shardOf(id)` (djb2 hash), so no single key nears the browser's ~5MB per-key ceiling. Settings/strategies/preferences/theme live in one `brij-tj-meta-v1` key. Screenshots are heavy base64 and live per trade in `brij-tj-shots-<id>`, loaded only on edit/view/export — the trade record just carries `screenshotCount`.

Three invariants in the root `App`:
- **Meta and trades save in separate effects.** Preferences churn on every tab switch; folding them together would rewrite all 24 shards each time. (Minting a trade id does write meta, via the `tradeSeq` counter — that is one small key, not the shards, so the invariant holds.)
- **`writtenShardsRef`** holds the last serialized payload per shard, seeded from disk at boot, so a save writes only the shards that actually changed.
- **`loadError` disables all persistence.** A failed read leaves `trades` empty; writing that back would delete every shard on disk.

### Trade computation

`computeTrade(t)` derives everything (RR, P&L, duration, fill aggregates) and caches against the source object in a `WeakMap`. This is only sound because trade objects are always **replaced, never mutated** — keep it that way.

`stripComputed(trade)` must be applied before anything is written (save, backup export, restore). The form edits a *computed* trade; without this, derived fields get stored as stale copies. `COMPUTED_TRADE_KEYS` is the list.

### Error handling

`ErrorBoundary` (App.tsx, the one class component this codebase needs) wraps the root `App` render and catches render-time throws anywhere below it, showing a themed fallback screen (Reload button, error message, reuses `BOOT_CSS`/`boot-error` styling) instead of a blank page. It logs via `console.error` — no external error reporting, the app is offline-only. This is a render-layer catch only: it does not touch storage, disable persistence, or run when a *storage read* fails (that's `loadError`, a separate boot-time state inside `App` itself — see Sharded trade persistence above).

### Data model (v3) — legacy fallbacks are load-bearing

Journals written by 2.x are still on disk. Every v3 field is additive with a fallback; do not "clean these up":

- **Accounts** — `settings.accounts[]`. Pre-v3 journals have only `settings.startingBalance` and trades with no `accountId`; `normalizeAccounts()` folds that into one account whose id is literally `acct-main` (`DEFAULT_ACCOUNT_ID`), which legacy trades resolve to. `settings.startingBalance` is still written, mirroring `accounts[0]`, purely so a 2.x build can read a v3 journal. An unknown/dangling `accountId` always resolves to `accounts[0]`, so deleting an account never orphans its trades.
- **Fill legs** — optional `entries[]`/`exits[]`. `aggregateLegs()` returns the size-weighted average, and legs outrank `entryPrice`/`exitPrice`/`positionSize`. The form mirrors the aggregate back onto those flat fields so leg-unaware code still sees a coherent trade. P&L uses matched qty = `min(entryQty, exitQty)`; the remainder is `_openQty`.
- **Fee split** — `commission` + `swap`, with `fees` remaining the total of record, rewritten on save. Either split field present means the total is their sum; neither means `fees` is the total (pre-split journal or CSV import).
- **Journal timezone** — `settings.timezone` (IANA id, `""` = follow the machine = pre-v3.2 behaviour). Moves **only "now"** (today keys, presets, calendar highlight, clock, picker prefill) via `zonedNow()`; stored trade times are naive wall-clock strings and are never shifted. Reaches leaf components via `TimezoneContext` in App.tsx, whose `""` default keeps provider-less component tests on legacy behaviour. `tzOffsetLabel()` renders the live GMT offset (DST-aware) on the picker's options and the topbar clock; the picker's list is ordered west→east by `tzOffsetMinutes()`, alphabetical within an offset. See [ARCHITECTURE.md](ARCHITECTURE.md#the-journal-timezone).
- **Journal (three grains)** — daily/weekly/yearly, one note store each: `preferences.dayNotes` (day key, the **same map** the calendar's day notes edit — nothing to sync), `preferences.weekNotes` (`isoWeekKey`, `2026-W29`), `preferences.yearNotes` (`2026`). One `JournalSection` renders any grain (config in `JOURNAL_GRAINS`); it is keyed by grain so switching remounts it and its filter/new-key reset. `journalEntries(notes, kind)` reads any store — `JOURNAL_KEY_PATTERNS[kind]` picks the key shape it keeps, so a foreign key shape (or the pre-fix UTC day stragglers) is dropped. Each grain has its **own** session filter (day/week/year range + note text, `filterJournalEntries`, collapsed behind a toolbar Filter button) that narrows the list **and** every export — Markdown / CSV / Word / PDF via `journalToMarkdown` / `journalToCSV` / `journalToHtml` (the exporters take the filtered entries *array*, not the raw map; newest first, blanks dropped).
- **Strategy playbook** — `settings.strategyNotes`, name → free text, normalized by `normalizeStrategyNotes` (plain string map, blanks dropped, 5000-char cap). Lives on its **own Playbook tab** (moved out of Settings in 3.3). A note deliberately survives its strategy being renamed or removed — the name coming back finds it intact.
- **Analytics chart windows** — `preferences.weeklyChartCount` / `monthlyChartCount` / `yearlyChartCount` (default 5, ladder `CHART_PERIOD_CHOICES`, 0 = all) window the Weekly/Monthly/Yearly Performance charts to the most recent N periods via `slice(-N)` over `groupPerformance`'s ascending rows. The trade-based charts window to the most recent N **closed trades** instead: `rrChartCount` / `hourChartCount` / `durationChartCount` feed `mostRecentTrades(closed, n)` (newest exit first, open trades sort last) for RR Distribution / Performance by Hour of Day / Trade Duration Analysis.
- **Cashflow** — `settings.transactions[]`: deposits and withdrawals, normalized by `normalizeTransactions` (amount stored **positive**, sign lives in `type`, non-positive/junk rows dropped). Per-account like trades — an unknown `accountId` resolves to `accounts[0]` via `sortedTransactions`. An account's balance = its starting balance + trade P&L + `transactionsNet` (deposits up, withdrawals down); Dashboard, the Cashflow tab and the Settings account list all fold this in, so they never disagree. The **Cashflow tab** has its own filter (`filterTransactions`: date range / type / note) that narrows the list and its running-balance column and touches nothing else. Deposits/withdrawals use the neutral accent + direction icons, never P&L green/red.
- **Login gate** — opt-in, soft: `AUTH_KEY` (`brij-tj-auth-v1`) holds `{users:[{id,username,salt,hash}]}`, kept **out of the meta blob** so password hashes never ride along in a journal backup. `lib/auth.ts` hashes with PBKDF2-SHA-256; no plaintext is stored. Zero users = no gate (backward compatible). Creating the first account (Settings > Security) turns the gate on and signs the creator in; removing the last user turns it off. `signedIn` is derived (not stored), so removing the session's user re-shows the gate with no effect. Session lives in memory only — closing the app signs out. **Multi-user and web-future ready:** the store is a list, and swapping `AuthGate`'s local `verifyPassword` for a network call leaves the shell unchanged (see [ARCHITECTURE.md](ARCHITECTURE.md#authentication)). It gates the running app, **not** the files on disk — not disk encryption.
- **Help tab** — read-only About / per-tab guides / keyboard shortcuts / data-privacy note, showing the live `APP_VERSION`. The editable journal name / tagline / avatar stay in Settings > About.

Each of these is pinned by tests in `trade.test.js`. If a test named for a legacy fallback goes red, a real journal on disk just stopped loading correctly — do not delete the test.

`preferences.activeAccountId` (`""` = all pooled) is a **view** choice, resolved against the live account list on every read rather than stored back — so a stale id shows the pooled view instead of reading as an empty journal.

### Styling

No CSS framework or modules. `APP_CSS` is one module-scope template string of theme-independent CSS using `var(--token)`; the 12 themes in `THEMES` inject their own token sets. Colour semantics are strict: green/red mean P&L only, `--accent` is the neutral brand colour.

Fonts are self-hosted via `@fontsource` imports in `main.jsx` — never add a remote `@import`, the packaged app runs offline and would silently fall back to system fonts.

### Charts

Every `Bar`, `Pie` and `Area` in `Charts.tsx` sets `isAnimationActive={false}`, and new ones must too. Recharts' entrance animation doesn't complete when the module mounts lazily, leaving marks stuck at zero size and hiding `<LabelList>` labels entirely.

### Exports

`saveTextExport` / `saveBinaryExport` (App.tsx) hide the desktop/web split: Electron gets a native Save As via `window.desktopExport`, the web build downloads a blob. PDF is real `printToPDF` in an offscreen window on desktop, and an offscreen-iframe print dialog on web. All free text going into HTML/Word reports goes through `escapeHtml()`. `xlsx` is imported on demand inside the Excel exporter, not at module scope. It installs from a `cdn.sheetjs.com` tarball URL, not the npm registry (abandoned at 0.18.5 with open advisories) — never revert it to a semver range; see [KNOWN_ISSUES.md](KNOWN_ISSUES.md) non-issues.

## Release / packaging rules

Full checklist in [RELEASING.md](RELEASING.md). The rules that must not be broken:

- `version` in package.json is the **only** field a release bumps. `vite.config.js` injects it as `__APP_VERSION__` (declared as a global in eslint config), so Settings > About can't drift.
- **`name: "tradingjournal"` is load-bearing.** Electron derives `userData` from `name`, not from `build.productName` — changing it strands the user's trades. `productName` only renames the exe/installer, and was deliberately renamed to `"Trade Journal"` in 3.3 (the display rebrand) — the journal still lives under `%APPDATA%\tradingjournal` precisely because `name` did not move. `migrateLegacyStorage()` in `main.cjs` is a one-time copy in from older `name` values. Leave `name` and `build.appId` alone.
- **`build.publish: null` is deliberate.** Without it, electron-builder detects the git remote and writes `latest.yml` update metadata regardless. Distribution is manual download; do not re-add a publish config or wire up electron-updater.
- `npm run dist` works on this machine as of 2026-07-17 — the owner added a Defender real-time-protection exclusion for the repo. Without that exclusion it fails with `EPERM: operation not permitted, rename 'release\win-unpacked.tmp' -> 'release\win-unpacked'` (real-time protection holds a handle on freshly extracted Electron files; a fresh output dir does **not** dodge it). If the failure reappears, the exclusion has been removed — it is a security setting the user must change themselves.
