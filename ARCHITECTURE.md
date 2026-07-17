# Architecture

Reference for the parts that take more than one file to understand. [CLAUDE.md](CLAUDE.md) is the short operational version; this is the detail behind it.

## Shape of the thing

One codebase, two products:

- **Web build** — `npm run dev` / `npm run build`. React + Vite. Storage is IndexedDB.
- **Desktop build** — `npm run electron:dev` / `npm run dist`. The same renderer inside an Electron shell. Storage is real JSON files. Adds a native Save As and true PDF printing.

No backend. No network calls at runtime. The packaged app must work with the machine offline — that constraint is why fonts are self-hosted and why `xlsx` is bundled rather than fetched.

```
index.html        static shell — its <title> must match APP_NAME in App.jsx;
                  it is what shows before React mounts (and if it never does)
src/
  main.jsx        entry; @fontsource imports; mounts <App>
  App.jsx         the React shell — CSS, tokens, panels, modals, root state
  Charts.jsx      every Recharts component (lazy-loaded chunk)
  lib/
    trade.js      THE RULES — maths, stats, dates, sharding, CSV, normalization
    trade.test.js the feature suite
    format.js     display formatting
    storage.js    backend switch
electron/
  main.cjs        storage IPC, export dialogs, window state, single-instance lock
  preload.cjs     contextBridge: window.electronStorage, window.desktopExport
```

**Import direction is one-way: `App.jsx` → `lib/*`.** `Charts.jsx`, `format.js` and `trade.js` must never import `App.jsx`. It is circular, and it would pull the whole app into the lazily-loaded chart chunk, undoing the ~300kB code split that is the only reason `Charts.jsx` exists as a separate file. The linter enforces this: a `no-restricted-imports` block in `eslint.config.js` scoped to `src/lib/**` and `src/Charts.jsx` fails the build on any import of App.

Practical rule: **pure logic goes in `lib/trade.js` with a test. Anything touching `window`, `document` or `storage` stays in `App.jsx`.**

## Storage

### One interface, two backends

`lib/storage.js` exports `storage` — `get` / `set` / `delete` / `list`, all promise-returning. It picks a backend once, at import:

```js
const hasElectron = typeof window !== "undefined" && !!window.electronStorage;
```

Inside Electron every call becomes an IPC round trip to `main.cjs`, which reads and writes one JSON file per key under `%APPDATA%\tradingjournal\storage`. In a browser it falls back to IndexedDB (hundreds of MB available — enough for a screenshot-heavy journal without a server).

App code never branches on which is live. That is the whole point of the file.

### Writes are atomic, and async on purpose

`main.cjs` writes to `<file>.<pid>.tmp` and `rename`s it into place. `rename` is atomic on the same volume, so a crash mid-write leaves the previous shard intact rather than a truncated one that won't parse.

Every fs call in the storage handlers is async. The sync versions stalled the main process — the same thread servicing window and IPC events — and since one save touches many shards, those stalls stacked.

### On-disk format, and the legacy wrapper

Values arrive already serialized by the renderer and are written **verbatim**. Older builds re-wrapped them as `{"value": "<json>"}`, escaping an already-valid JSON string. `unwrapStored()` still reads those:

```js
const LEGACY_WRAPPER_PREFIX = '{"value":"';
```

The test is an exact prefix match, not a heuristic — current payloads always start with `[` (shard array), `{"settings":` (meta) or `{"screenshots":` (shots), none of which can collide. Legacy files are rewritten in the new format the next time that key is saved. No migration step, no flag day.

### Sharding

Trades are spread across `SHARD_COUNT = 24` keys, `brij-tj-shard-<n>`, by a djb2 hash of the trade id:

```js
export function shardOf(id) { return djb2(String(id)) % SHARD_COUNT; }
```

So no single key nears the browser's ~5MB per-key ceiling as the journal grows.

- **Meta** — settings, strategies, preferences, theme, last-used defaults — is one key, `brij-tj-meta-v1`.
- **Screenshots** are heavy base64 and live per trade in `brij-tj-shots-<id>`. They are loaded only on edit, view or export. The trade record itself carries just `screenshotCount`.

`shardOf` must stay deterministic forever. Change the hash and every existing trade is looked for in the wrong shard. The suite pins this.

### Three invariants in the root `App`

1. **Meta and trades save in separate effects.** Preferences churn constantly — every tab switch writes them. Folding that into the trade save would rewrite all 24 shards each time, for trade data that never changed.
2. **`writtenShardsRef`** holds the last serialized payload per shard, seeded from disk at boot. A save diffs against it and writes only shards that actually changed — one trade edit writes one key, not 24. The baseline is updated *only after* the writes land, so a failed write retries next time instead of assuming disk matches memory.
3. **`loadError` disables all persistence.** If the boot read throws, `trades` is empty for the wrong reason. Writing that back would delete every shard on disk. Both save effects bail on `loadError`.

A single-instance lock in `main.cjs` backs this up: two copies of the app would be two independent writers racing over the same shard files, and atomic rename protects a single write, not two processes.

## Trade computation

`computeTrade(t)` derives everything — RR, P&L, duration, fee totals, fill aggregates — and caches against the source object in a `WeakMap`:

```js
const computedTradeCache = new WeakMap();
```

**This is only sound because trade objects are always replaced, never mutated.** Mutate one in place and you get a stale derivation back forever. Keep it that way.

`stripComputed(trade)` removes every derived field (`COMPUTED_TRADE_KEYS`) and must run before anything is written — save, backup export, restore. The form edits a *computed* trade, so without it the derived fields ride along into storage as stale copies of numbers that are recalculated on read anyway.

### The maths

- **Expected RR** = reward distance (entry → take profit) / risk distance (entry → stop loss)
- **Actual RR** = captured distance (entry → exit) / risk distance

Both are direction-aware and derived purely from price levels — never entered by hand. No risk distance (stop == entry) means no RR, not zero.

P&L is `(exit - entry) * qty` for a long, inverted for a short, minus fees. `pnlPercent` is against notional (`entry * qty`). Result is `win` / `loss` / `breakeven` with a `1e-7` epsilon, so float dust doesn't call a flat trade a win.

## Data model (v3)

Journals written by 2.x are still on disk. **Every v3 field is additive with a fallback, and the fallbacks are load-bearing.** Each is pinned by a test named for the behaviour — if one goes red, a real journal just stopped loading.

### Accounts

`settings.accounts[]` — `{ id, name, broker, startingBalance }`.

Pre-v3 journals have no `accounts` and no `accountId` on trades: just a top-level `settings.startingBalance`. `normalizeAccounts()` folds that shape into a single account whose id is literally `acct-main` (`DEFAULT_ACCOUNT_ID`) — the id legacy trades resolve to via the fallback. That constant must not change.

`normalizeAccounts` guarantees a **non-empty list where every entry has an id and a name**, whatever it is handed (a hand-edited backup, `null`, garbage). The whole app resolves a trade's account against `accounts[0]` as fallback.

`settings.startingBalance` is still written on every save, mirroring `accounts[0].startingBalance`. Nothing in v3 reads it. It exists so a 2.x build can still open a v3 journal. Removing it strands anyone who rolls back.

Deleting an account never orphans its trades — a dangling `accountId` resolves to `accounts[0]`, and editing the trade heals it.

`preferences.activeAccountId` (`""` = all accounts pooled) is a **view** choice, not data. It is resolved against the live account list on every read rather than stored back, so a stale id shows the pooled view instead of scoping to an account that matches nothing and reading as an empty journal.

### Appearance preferences

`preferences.density` — `"comfortable"` (default) or `"compact"`; anything else merges back to comfortable. Applied as a `density-compact` class on `.app-root` whose overrides tighten the repeating surfaces (cards, panels, table rows) and leave one-off chrome alone.

`preferences.hiddenColumns` — trades-table column keys the user switched off (see `TRADE_COLUMNS` in App.jsx; Symbol and P&L are locked on). Merged to a clean string array whatever was stored; unknown keys are harmless.

`preferences.tableSort` / `preferences.pageSize` — the trades table's sort order (`{ key, dir }`) and rows-per-page (one of `PAGE_SIZES`). The table seeds its own state from these on mount and reports changes back up — it unmounts on every tab switch, and a table that comes back reshuffled reads as the data having changed. `mergePreferences` repairs a corrupt sort to the default and coerces an unknown page size back to 50.

`preferences.accent` — a `#rrggbb` accent override riding every theme, `""` = the theme's own. `normalizeAccent()` guarantees the shape, so the CSS injected from it (`--accent` plus a re-derived `--accent-soft`, after `themeCss` on the same selector so it wins the tie) can't be fed junk. The preset row deliberately offers no green and no red — those mean P&L only.

### Journal branding and UI zoom

`settings.journalName` / `settings.journalTagline` — the journal's own name and tagline, shown in the sidebar brand, the window title and on report headers (escaped through `escapeHtml()` there like any free text). Both additive with `""` as the default, meaning "use the built-in name" — a journal that never set one keeps tracking whatever the build calls itself, and pre-existing journals load unchanged. `mergeSettings` trims and length-caps them (40 / 60 chars) and coerces non-strings to empty.

`preferences.zoom` — the UI scale factor (1 = 100%), stepped with Ctrl +/− along `ZOOM_LEVELS` (the browser's own ladder) and reset with Ctrl+0. `mergePreferences` clamps a stored factor into the ladder's range, so a corrupt value can't wedge the app unreadable. How it is *applied* is per build and lives outside lib: desktop asks the main process for native `webContents` zoom over IPC (`zoom:set`, exposed as `window.desktopZoom`), the web build falls back to CSS zoom on `<body>`.

### Fill legs (scaling in and out)

Optional `entries[]` / `exits[]` — `{ id, price, qty, datetime }`. Absent means a plain one-in-one-out trade, which is the shape of every pre-v3 trade.

`aggregateLegs()` collapses legs into one size-weighted fill. Scaling in at 100 and 90 with one lot each *is* one lot-weighted fill at 95, so nothing downstream — RR, P&L, the charts — needs any notion of legs. Legs **outrank** `entryPrice` / `exitPrice` / `positionSize`; the form mirrors the aggregate back onto those flat fields (`withDerivedFills`) so leg-unaware code still sees a coherent trade.

P&L is earned only on size that both entered and left: `qty = min(entryQty, exitQty)`. Scale out half and you realise half; the remainder is `_openQty` and `_partial` is set. Legs also override the trade's dates — first fill in, last fill out — so filtering and the calendar read the real span.

A leg missing a price or with a non-positive qty is **skipped**, not counted as zero, which would drag the weighted average down.

### Fee split

`commission` + `swap`, with `fees` remaining the **total of record**, rewritten on every save.

- Either split field present → the total is their sum (a blank half counts as zero, so a commission-only trade needs no `0` typed into swap).
- Neither present → `fees` is the total (pre-split journal, or a CSV import).

`tradeToForm()` seeds `commission` from a legacy `fees` so editing an old trade doesn't zero its cost with two empty split fields.

The CSV export/import round trip is lossless for both shapes — split fees and a pre-split `fees` total. That rests on `findCsvField` skipping a present-but-empty aliased column (our export writes `Commission,Swap,Fees` side by side, and a pre-split trade fills only `Fees`); see [KNOWN_ISSUES.md § Fixed](KNOWN_ISSUES.md#fixed).

## Dates

`isoDate()` is the app's day key — the calendar grid, day filter, dashboard "today" and every preset are built on it. It formats from **local** parts (`getFullYear`/`getMonth`/`getDate`), never `toISOString()`, because every caller hands it a Date built from local components: a trade's exit time, a calendar cell, "now".

> Do not "simplify" it back to `toISOString().slice(0, 10)`. That returns a UTC day, which agrees with the local one only at UTC+0. At IST it filed every trade before 05:30 under the previous day and keyed each calendar cell one day off its own label — the app's largest defect for most of its life. The suite is pinned to `TZ=Asia/Kolkata` precisely so a regression here fails instead of hiding: on a UTC machine the broken version passes every test.

Because the key ignores time-of-day, a day is bounded by its local midnight and there is no separate "end of day" step — `dateRangeForPreset` takes `isoDate` of both ends.

`toLocalInputValue` / `parseLocalInputValue` bridge Date and the form's `datetime-local` input, and are local throughout.

**`preferences.dayNotes` is keyed by this same day key.** Notes written before the key became local sit under the old UTC day; they were not migrated, because a key alone doesn't say which scheme wrote it (the monthly grid used a local key even then, the weekly grid a UTC one, so a blind shift would mis-file the ones that were already right). A note that was mis-filed under the old key stays where it was written.

## Trade ids

`nextTradeId(trades, floor)` mints `TJ-00001`-style ids. `floor` is a high-water mark persisted as `tradeSeq` in the meta record, seeded on load to `max(stored counter, highest id on disk)` so it can start late but never go backwards.

> The counter exists because the live trade list is not a safe source for the next id. Deleting a trade takes its number out of the list while the Undo toast still holds the record — so the next trade minted inside that window got the same id, and Undo restored a duplicate. Two trades sharing an id share a shard entry, a React key and a screenshot key, and editing one rewrites both.

## Navigation

Tabs are plain state in the root `App` (`setTab`), with an in-memory back/forward history behind the topbar arrows and Alt+←/→ (deliberately not persisted: restoring a stale stack would let Back lead somewhere the user never went this session). Ctrl/Cmd+1–6 jumps straight to a tab; both paths are gated while a dialog is open so navigation can't strand unsaved edits underneath one.

Tab switches run through `withTabTransition`, which uses the View Transitions API (`document.startViewTransition` + `flushSync`) for a ~140ms crossfade where the browser supports it — skipped under `prefers-reduced-motion`, plain synchronous update otherwise.

**Trades-table row cursor** — J/K or ↑/↓ move a highlighted row on the visible page; Enter views it, E edits, X toggles its selection. The listener stands down whenever `document.body.style.overflow` is `"hidden"` — every overlay (Modal, palette) freezes body scroll, so that one check covers "something is open above the table" without the table knowing about any of them. The cursor is clamped at read time rather than reset by an effect when sorting or filtering shrinks the list.

**Command palette** — Ctrl/Cmd+K. Actions (new trade, tab jumps, sidebar, shortcuts, the 12 themes) plus a live trade search over the whole journal (id / symbol / direction / status / market / strategy / tags / account — global on purpose, not scoped to the account in view). Matching and ranking are `paletteFilter()` in `lib/trade.js` — pure, token-AND, word-start-over-mid-word — pinned by tests; the component in App.jsx is just the shell. With no query only the leading actions show, so the idle list stays short.

## Styling

No CSS framework, no CSS modules. `APP_CSS` is a single module-scope template string of **theme-independent** CSS, all colours as `var(--token)`. The 12 themes in `THEMES` each inject their own token set. Kept at module scope so a multi-thousand-character string is built once at import, not on every render.

Colour semantics are strict:

- **green / red mean P&L. Nothing else.**
- `--accent` is the neutral brand colour, used wherever something needs emphasis without implying profit or loss.
- `--accent-2` is a secondary accent for grading and highlights.

Fonts (Inter, Space Grotesk, JetBrains Mono) are self-hosted via `@fontsource` imports in `main.jsx`. **Never add a remote `@import`** — the packaged app runs offline and would silently fall back to system fonts.

## Charts

`Charts.jsx` holds every Recharts component and is pulled in with `React.lazy` via `lazyChart()` in App.jsx, keeping ~300kB of charting out of the initial bundle. Once the app has loaded, an idle-time effect in App warms the chunk (`import("./Charts")` under `requestIdleCallback` — the same specifier `lazyChart` uses, so Vite reuses one chunk): a session restored onto a chartless tab then doesn't pay the download on its first visit to Dashboard or Analytics. While the chunk loads, each chart's Suspense fallback is a `.chart-loading` shimmer sized to the chart it replaces.

**Every `Bar`, `Pie` and `Area` sets `isAnimationActive={false}`, and new ones must too.** Recharts' entrance animation doesn't run to completion when the module mounts lazily, which leaves marks stuck at their zero-size first frame: bars render as nothing, pie sectors collapse to radius 0. Recharts also gates `<LabelList>` on the parent's animation having finished, so leaving animation on hides value labels even where the bars survive.

## Exports

`saveTextExport` / `saveBinaryExport` in App.jsx hide the desktop/web split — Electron gets a native Save As through `window.desktopExport`, the web build downloads a blob. Every helper resolves `{ ok, canceled?, path? }` so callers can toast without caring which ran.

- **PDF** — desktop renders the report HTML in an offscreen `BrowserWindow` and calls `printToPDF` (a real PDF). Web writes the HTML into an offscreen iframe and opens the print dialog, where the user picks "Save as PDF".
- **Excel** — `xlsx` is imported on demand *inside* the exporter, not at module scope, so it stays out of the main bundle.
- **HTML / Word** — all free text goes through `escapeHtml()`. Symbols, strategy names and notes are user input; interpolated raw they break the document or inject tags.
- **CSV** — `tradesToCSV` / `parseCSV` are a matched pair: the quoting `csvCell` writes is exactly what `parseCSV` reads back. On import, `partitionDuplicateImports()` splits incoming rows against the journal by symbol + entry time; rows that match an existing trade (a statement imported twice) go to a choice dialog instead of landing silently, and rows dropped for having no symbol or entry price are counted in the result message rather than vanishing.

Restoring a JSON backup is gated behind a confirmation showing both journals' trade counts — it replaces everything, same blast radius as Clear All. The backup export itself goes through `saveTextExport` like every other file, so the desktop build gets its native Save As.

## Electron shell

- **The renderer is sandboxed** — `sandbox: true`, with `contextIsolation` on and `nodeIntegration` off. `preload.cjs` may only touch `contextBridge` and `ipcRenderer` (the two things a sandboxed preload still gets); requiring any other Node module there breaks under sandbox. New desktop capability = a new `ipcMain.handle` in `main.cjs` exposed through the bridge, never a Node require in preload.
- **Single-instance lock** — a second launch focuses the running window instead of becoming a second writer.
- **`migrateLegacyStorage()`** — a one-time copy *into* the current userData from older `name` folders (`brijtradejournal`, `Brij Trade Journal`, `Trading Journal`) when the current one is empty, so an upgrade never looks like a wiped journal. Best-effort.
- **Auto-backup** — `autoBackupStorage()` snapshots the whole storage directory into `userData\backups\<YYYY-MM-DD>\` once per local day, at launch (a quit-time copy would race process exit; a launch-time one captures the journal as the session found it). Copies land in a `.tmp` directory renamed into place so a killed launch can't leave a half-backup, and only the newest 5 days are kept. Restore is manual: copy the files back into `storage\` with the app closed. Desktop only — the web build has no filesystem to snapshot to.
- **UI zoom** — `zoom:set` applies the renderer's persisted zoom preference through native `webContents` zoom (scales scrollbars and all, unlike CSS zoom). The renderer owns the level; main just clamps and applies.
- **Window state** — size, position and maximized state persist, validated against the displays present at startup so a window saved on a since-disconnected monitor is pulled back onto a visible screen. Two hard-won details are commented in place: minimums are capped to the actual work area (a min-height taller than the screen makes Windows silently refuse to maximize), and `maximize()` must come *after* `show()` (on a hidden window Windows applies the geometry without entering the zoomed state, and `isMaximized()` then reports false and destroys the saved preference).

See [RELEASING.md](RELEASING.md) for why `name`, `appId` and `publish: null` must be left alone.
