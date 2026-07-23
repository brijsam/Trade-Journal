# Architecture

Reference for the parts that take more than one file to understand. [CLAUDE.md](CLAUDE.md) is the short operational version; this is the detail behind it.

## Shape of the thing

One codebase, two products:

- **Web build** — `npm run dev` / `npm run build`. React + Vite. Storage is IndexedDB.
- **Desktop build** — `npm run electron:dev` / `npm run dist`. The same renderer inside an Electron shell. Storage is real JSON files. Adds a native Save As and true PDF printing.

No backend. No network calls at runtime. The packaged app must work with the machine offline — that constraint is why fonts are self-hosted and why `xlsx` is bundled rather than fetched.

```
index.html        static shell — its <title> must match APP_NAME in App.tsx;
                  it is what shows before React mounts (and if it never does)
src/
  main.jsx        entry; @fontsource imports; mounts <App>
  App.tsx         the React shell — CSS, tokens, panels, modals, root state
  Charts.tsx      every Recharts component (lazy-loaded chunk)
  lib/
    trade.ts      THE RULES — maths, stats, dates, sharding, CSV, cashflow, normalization
    trade.test.js the feature suite
    auth.ts       login-gate logic — PBKDF2 hashing (Web Crypto), user records
    auth.test.js  the auth suite
    format.ts     display formatting
    storage.ts    backend switch
electron/
  main.cjs        storage IPC, export dialogs, window state, single-instance lock
  preload.cjs     contextBridge: window.electronStorage, window.desktopExport
```

**Import direction is one-way: `App.tsx` → `lib/*`.** `Charts.tsx`, `format.ts` and `trade.ts` must never import `App.tsx`. It is circular, and it would pull the whole app into the lazily-loaded chart chunk, undoing the ~300kB code split that is the only reason `Charts.tsx` exists as a separate file. The linter enforces this: a `no-restricted-imports` block in `eslint.config.js` scoped to `src/lib/**` and `src/Charts.tsx` fails the build on any import of App.

Practical rule: **pure logic goes in `lib/trade.ts` with a test. Anything touching `window`, `document` or `storage` stays in `App.tsx`.**

TypeScript is used throughout (`strict: true`, `tsc --noEmit` chained into `npm run lint`) — see CLAUDE.md § Type safety for the domain types and the two type-collapse traps worth knowing before extending them. Only `main.jsx` and the test files stay plain JS.

## Storage

### One interface, two backends

`lib/storage.ts` exports `storage` — `get` / `set` / `delete` / `list`, all promise-returning. It picks a backend once, at import:

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

`loadError` only catches a failed **storage read**. A throw during **render** — anywhere in the component tree, at any point after boot — is a different failure mode with no `loadError` state to catch it, and previously white-screened the app. `ErrorBoundary` (App.tsx, wraps the root `App` render) catches that case: `getDerivedStateFromError` + `componentDidCatch` show a themed fallback screen with a Reload button and log via `console.error`, without touching storage or the save effects — a render bug and a data-loss bug stay distinct failure paths.

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

`preferences.hiddenColumns` — trades-table column keys the user switched off (see `TRADE_COLUMNS` in App.tsx; Symbol and P&L are locked on). Merged to a clean string array whatever was stored; unknown keys are harmless.

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

### The journal timezone

`settings.timezone` (an IANA id; `""` = follow the machine, the default and the pre-v3.2 behaviour) moves **only "now"**: the dashboard's Today/This Week/This Month keys, `dateRangeForPreset`'s presets, the calendar's today highlight, the topbar clock, the date picker's prefill and Now button, and export file stamps. `zonedNow(tz, at)` in `lib/trade.ts` is the single bridge — it reads `at`'s wall clock in `tz` via `Intl.DateTimeFormat` and returns it as a naive local-parts Date, so `isoDate`, the presets and the picker keep working unchanged on what it returns.

> Stored trade times are naive wall-clock strings and are **never shifted** — what the user typed is what every zone shows. That asymmetry is the design: a trader journalling the New York session types NY times, and the setting makes "today" agree with those times instead of the machine's clock. Changing the zone must never rewrite or re-bucket an existing trade; there is deliberately no conversion step anywhere.

The setting reaches leaf components through `TimezoneContext` in App.tsx (default `""`), not props — and that default is load-bearing: the component tests render `TradeForm`/`TradesTable` without the provider and get legacy machine-zone behaviour. An unknown zone id (a journal restored onto a runtime with an older tz database) normalizes to `""` in `mergeSettings` rather than failing the load.

`tzOffsetLabel(tz, at)` renders a zone's live GMT offset (`GMT+5:30`, `GMT-4`) — derived from `zonedNow` so the two can never disagree, and "now"-relative because DST moves it through the year. It marks the topbar clock whenever the journal is pinned to a zone, so a clock that disagrees with the machine's taskbar explains itself. The clock itself renders 12- or 24-hour from `preferences.clockFormat` (`"12h"` legacy default, constrained in `mergePreferences`).

#### Picking a zone

The runtime hands over ~400 IANA ids (`Intl.supportedValuesOf("timeZone")`). A `<select>` of that length has no search and no structure, so Settings uses `TimezonePicker`, a combobox over the same list:

- **Ascending by offset**, zone id as the tiebreak, so "somewhere around GMT+02:00" is one contiguous block rather than an alphabetical scatter.
- **One sticky heading per distinct offset**, rendered by `offsetLabelPadded` as a fixed-width `+HH:MM GMT` — offset first, so a column of them lines up on the sign. Every heading being the same shape is what makes the list read as an even ladder of :00/:30 steps (with the genuine :45 zones — Kathmandu, Chatham — sitting in it honestly rather than being rounded away).
- **Search over city, region or offset**, every whitespace-separated term having to match (`filterTimezoneOptions`): "asia 05:30" narrows, "asia york" finds nothing. An offset can be typed as `gmt+5:30`, `+5:30`, `5:30` or `05:30`; unsigned reaches both sides of the meridian.
- Keyboard: ↑/↓/Home/End move the cursor, Enter picks, Escape closes, and the list is a real `listbox` with `aria-activedescendant` on the search input.

`timezoneOptions` / `filterTimezoneOptions` / `groupTimezoneOptions` live in `lib/trade.ts` and are pure, so the ordering and matching rules are pinned by tests rather than asserted through a rendered popover; the component is only the widget. Two behaviours it keeps from the old `<select>`: the machine's own zone is offered first as **System** and reports `""` (not the machine's id) when picked, and a zone this runtime doesn't list — a journal restored from a machine with a newer tz database — stays displayed and selected rather than silently snapping to System.

### The journal (three grains)

The Journal tab has three grains — **Daily**, **Weekly**, **Yearly** — each its own note store: `preferences.dayNotes` (day key), `preferences.weekNotes` (`isoWeekKey`, `2026-W29`), `preferences.yearNotes` (`2026`). The daily store is the **same map** the calendar's day-note editor writes — "sync" between them is that there is nothing to sync. Deleting an entry stores `""`, which every reader treats as absent.

One `JournalSection` component renders whichever grain is active; everything grain-specific (which store, how to key "now", how to bucket a trade's stats, the entry label, the add-input type) comes from a `JOURNAL_GRAINS[grain]` config. `JournalPanel` keys `<JournalSection key={grain}>` so switching grains **remounts** it — its new-key input, its filter and any open modal reset to the new grain rather than carrying a day-shaped key into the weekly input (which would leave the Add button disabled). `journalEntries(notes, kind)` reads any store: `JOURNAL_KEY_PATTERNS[kind]` picks the key shape it keeps, so a week note never leaks into the daily list, and the pre-fix UTC day stragglers (below) still drop out of the daily one.

Each grain carries its **own** session-only filter (inclusive range in the grain's units + case-insensitive note text, `filterJournalEntries` — deliberately not persisted: a filter left set weeks ago would read as vanished entries) that narrows the visible list **and** every export, so what's on screen is exactly what a file will hold. The filter row is collapsed behind a toolbar Filter button until asked for, and cannot collapse while a filter is set — hiding an active filter would make the narrowed list read as missing entries; the button carries the narrowed count (`Filter (3/12)`) while active. Four export formats share one pipeline: `journalEntries` (newest first, blanks and foreign-key-shaped keys dropped) → optional filter → `journalToMarkdown` (per-period trade stats on headings) / `journalToCSV` (the same quoting `parseCSV` reads back) / `journalToHtml`, which mirrors the trade report's Word-vs-PDF split — `forWord` adds the Office namespaces, the PDF variant gets `@page` sizing and goes through `desktop.savePDF` on desktop or the browser's print dialog on web. The exporters take the entries *array*, not the raw map — re-deriving inside each exporter would undo the filter.

### The strategy playbook

`settings.strategyNotes` (name → free text, `normalizeStrategyNotes`) renders on its own **Playbook tab** — moved out of Settings in 3.3 because a playbook is a working document a trader keeps open next to the charts, not configuration. It opens the same `StrategyManager` the trade form uses. A note survives its strategy being renamed away or removed; the name coming back finds it intact.

Each note sits directly under what that strategy actually returned — trades (with the open count), win rate, net P&L, average RR, profit factor, a win/loss bar and the last close date — from `strategyPerformance(trades, strategies)` in `lib/trade.ts`, which is `summarize()` per name plus the open-trade count that `summarize` deliberately excludes. The panel adds a search over **names and note text** ("liquidity" should find the strategy whose playbook mentions it) and sorts by list order / most traded / best P&L / best win rate. Three rules the sorting keeps:

- A strategy with **no** closed trades has no P&L or win rate to rank on, so it sorts *last* under the result-based sorts rather than tying with a genuine zero.
- An untraded strategy still gets a row. The note is the point of the tab; a blank record is not a reason to hide the page it is written on.
- A trade tagged with a strategy that has since been removed from the list is **not** folded into another row. It has no row at all — the same way its note survives unattached.

The panel takes `scopedTrades`, so the numbers follow the account in view like everything else outside Analytics.

`settings.strategyNotes` (the Strategy Playbook panel in Settings) is a name → text map through `normalizeStrategyNotes`: blanks dropped, 5000-char cap. Notes are keyed by strategy *name*, and a note whose strategy is renamed or removed is deliberately kept — StrategyManager can't rewrite settings from every mount point, and the cheap failure mode (an orphaned note waiting for its name to come back) beats the expensive one (a rename silently destroying a playbook page).

**`preferences.dayNotes` is keyed by this same day key.** Notes written before the key became local sit under the old UTC day; they were not migrated, because a key alone doesn't say which scheme wrote it (the monthly grid used a local key even then, the weekly grid a UTC one, so a blind shift would mis-file the ones that were already right). A note that was mis-filed under the old key stays where it was written.

## Cashflow

`settings.transactions[]` records money moving in and out of an account independently of trade P&L: a **deposit** adds to the balance, a **withdrawal** subtracts. `normalizeTransactions` stores the amount **positive** and puts the sign in `type`, so a hand-edited `-50` deposit can't silently become a withdrawal; non-positive amounts and unknown types drop, the way a blank journal note does. Each transaction belongs to an account like a trade does, and an unknown `accountId` resolves to `accounts[0]` (`sortedTransactions`), so deleting an account never orphans its cash history.

**One balance formula, three readers.** An account's balance is `startingBalance + trade P&L + transactionsNet` (deposits up, withdrawals down). The Dashboard's Account Balance card, the Cashflow tab's Account Balance card and the Settings account list all fold in the same `transactionsNet`, so they can't disagree. In App the scoped `cashNet` is added to the root `balance` and threaded onto `scopedSettings.transactions`; the Cashflow tab does its own account scoping from the full `settings.transactions`.

The **Cashflow tab** owns a session-only filter (`filterTransactions`: type / inclusive day range / note text) that narrows the list **and** its running-balance column — the request was explicit that this filter touches nothing else in the app. The running-balance column is computed over the *filtered* set, oldest→newest off the account's starting balance, so the column reads exactly what the filter shows; the Account Balance card stays on the *unfiltered* real figure, because a view filter narrows what you inspect, not the money you hold. Deposits/withdrawals render with the neutral `--accent` and direction icons, never the P&L green/red (see [§ Styling](#styling)).

## Calendar

One `PerformanceCalendar` renders five views (daily / weekly / monthly / yearly / custom) off one `byDay` map — day key → `{ pnl, count }`, built from **closed** trades by exit time — so every figure on the page comes from the same source and cannot disagree with the cells beside it.

- **Week totals.** The monthly grid is seven day cells plus that week's own summary cell, padded to whole weeks. It sums the same `byDay` entries the row displays, so a day outside the month in view simply isn't in the map and contributes nothing.
- **`dayBreakdown()`** (`lib/trade.ts`, pure and tested) reads that map as a whole: best day, worst day, the green/red/flat split, and the average *trading* day. Days are the unit risk is actually managed in — a daily-loss-limit rule is written against one — and "eleven green against four red" says something the per-trade win rate doesn't. The Best/Worst cards open that day's trades: the number is only useful next to what made it.
- **Every cell does something.** A day with trades opens them; a day without opens its note. A cell that looks like a button and does nothing is worse than one that does the only useful thing available.
- **Heat scale.** Shading is P&L against the largest absolute day (or month, in the yearly view) *in view*, so the scale re-fits per period; the legend states both ends and what they mean. A month cell in the yearly grid drills into that month.
- **Today** is one click from anywhere. The button disables rather than hides when the cursor is already there, so it never moves under the pointer.

## Authentication

An **opt-in, soft** login gate. `lib/auth.ts` is pure (PBKDF2-SHA-256 on `globalThis.crypto.subtle` — present in the browser, the Electron renderer and Node's test runtime): it hashes passwords, and normalizes/looks up user records. No password is ever stored — only a per-user random salt and the derived hash. The store lives in its **own** key `AUTH_KEY` (`brij-tj-auth-v1`), deliberately **outside** the meta blob, so password hashes never ride along in a journal backup export.

- **Zero users = no gate.** Existing journals keep opening straight to the app; nothing forces a password on anyone.
- **Turning it on.** Creating the first account (Settings > Security) writes the first user and signs the creator in, so they aren't bounced to the login screen mid-session. From then on a fresh launch shows `AuthGate`.
- **`signedIn` is derived, not stored** — `authUser && users.some(u => u.id === authUser.id)`. Removing the session's user (or the whole store) recomputes it to `false` and the gate returns, with no `setState`-in-effect needed. The session lives in memory only, so closing the app signs out.
- **A read failure leaves the gate off** rather than locking the owner out of their own data — the same fail-open stance the trade loader takes with `loadError` (fail-safe there, because writing an empty journal would delete it; fail-open here, because a hashing store the app can't read should never trap the owner).
- **Multi-user and web-future ready.** The store is a *list*, and `AuthGate` is a dumb screen that calls `verifyPassword`. A later internet-connected build swaps that local verify for a network call and moves the `{id, username, salt, hash}` shape server-side without the app shell changing. This is a gate on the running app, **not** disk encryption — the journal files are still plain on disk.

### Sign-up, and why it is off by default

`AuthGate` has two tabs, Sign in and Create account. The create path is gated on `allowSignup`, **off by default**: a login screen anyone can register past protects nothing, so on a single-owner machine the honest behaviour is to refuse and say why (the tab explains that an existing user must add the account from Settings > Security) rather than hide the control. The owner turns it on in Settings > Security for a shared desk where each person should have their own login — every account still opens the same journal; this is one book with several keys, not separate books.

The one exception is a journal with **no** accounts yet: there is nothing to sign in to, so the first sign-up is always allowed — that is how the gate gets turned on from the login screen at all. (`AuthGate` never renders in that state today, since zero users means no gate; the allowance exists so the screen is correct if it is ever reached, e.g. a build that opens on it.)

`allowSignup` is stored **in the auth blob, not settings**, for the same reason the user list is: the meta blob is what a journal backup carries, and restoring someone else's backup must not be able to switch self-signup on.

### The Profile tab

Appears only while signed in — with the gate off there is no user for it to be about — and is appended to `NAV` rather than slotted in, so `Ctrl/Cmd+1–9` keeps pointing at the same tabs it always did. It covers the person at the keyboard: avatar (falling back to initials), display name, username, member since, last sign-in, sign out, and a password change. Administration of *who may sign in at all* stays in Settings > Security; the two are deliberately separate screens.

Three additive fields carry it, each optional with a fallback so a store written before them loads unchanged: `displayName` (decoration — sign-in never looks at it; `displayNameOf()` falls back to the username), `avatar` (an inline `data:image/…` URL, downscaled by the picker and capped by `AVATAR_MAX_CHARS`, because this record is read on every launch), and `lastLoginAt` (stamped by the gate on a successful sign-in). The **username is not editable**: it is the identity every stored record is keyed to.

`changePassword()` verifies the current password before re-hashing — an unattended signed-in session must not be enough to take the account over — and draws a **fresh salt** with the new hash, so the old and new hashes aren't related in the store.

## Trade ids

`nextTradeId(trades, floor)` mints `TJ-00001`-style ids. `floor` is a high-water mark persisted as `tradeSeq` in the meta record, seeded on load to `max(stored counter, highest id on disk)` so it can start late but never go backwards.

> The counter exists because the live trade list is not a safe source for the next id. Deleting a trade takes its number out of the list while the Undo toast still holds the record — so the next trade minted inside that window got the same id, and Undo restored a duplicate. Two trades sharing an id share a shard entry, a React key and a screenshot key, and editing one rewrites both.

## Navigation

Tabs are plain state in the root `App` (`setTab`), with an in-memory back/forward history behind the topbar arrows and Alt+←/→ (deliberately not persisted: restoring a stale stack would let Back lead somewhere the user never went this session). Ctrl/Cmd+1–9 jumps straight to a tab (the shortcut spans `NAV.length`); both paths are gated on `!showForm && !viewing && openDialogCount === 0`, so navigation can't unmount an open dialog — the trade form, the trade detail view, or any `Modal` instance (confirms, the day-note editor, strategy manager, keyboard shortcuts…) — out from under unsaved edits. `openDialogCount` is a second module-level reference count next to `useBodyScrollLock`'s (same file, same pattern), deliberately *not* the same one: `CommandPalette` holds the scroll lock too, since it's allowed to open over a modal, but it isn't a dialog with edits to strand, so it must not gate navigation.

Tab switches run through `withTabTransition`, which uses the View Transitions API (`document.startViewTransition` + `flushSync`) for a ~140ms crossfade where the browser supports it — skipped under `prefers-reduced-motion`, plain synchronous update otherwise.

**Trades-table row cursor** — J/K or ↑/↓ move a highlighted row on the visible page; Enter views it, E edits, X toggles its selection. The listener stands down whenever `document.body.style.overflow` is `"hidden"` — every overlay (Modal, palette) freezes body scroll, so that one check covers "something is open above the table" without the table knowing about any of them. The cursor is clamped at read time rather than reset by an effect when sorting or filtering shrinks the list.

The freeze itself is `useBodyScrollLock()` — one module-level reference count shared by every `Modal` instance and `CommandPalette`, not each locking and restoring independently. The palette is deliberately allowed to open *on top of* a modal (Ctrl/Cmd+K works from inside a dialog), so two lockers being alive at once is normal; only the count reaching 0 touches the DOM, so whichever order they close in, the body ends up correctly unlocked. Two independent locks used to do this — closing the modal before the palette that opened on top of it left the body at `overflow: hidden` forever, with nothing left open to blame. See [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

**Command palette** — Ctrl/Cmd+K. Actions (new trade, tab jumps, sidebar, shortcuts, the 12 themes) plus a live trade search over the whole journal (id / symbol / direction / status / market / strategy / tags / account — global on purpose, not scoped to the account in view). Matching and ranking are `paletteFilter()` in `lib/trade.ts` — pure, token-AND, word-start-over-mid-word — pinned by tests; the component in App.tsx is just the shell. With no query only the leading actions show, so the idle list stays short.

**Trades table — reading what is on screen.** Three things answer "what am I actually looking at":

- A **totals row** (`<tfoot>`) over the trades the table was handed — which are the *filtered* ones, so it totals exactly what the filter selected, across pages and not just the visible one. `leadingCols` counts the columns before P&L so the summary spans them and each figure sits under the column it totals whatever the user has hidden; the P&L of a set with nothing closed reads `—`, not `$0.00`. It is sticky to the bottom, as the header is to the top.
- **Filter chips** under the filters bar, one per active narrowing, each removing only its own. `describeFilters()` (`lib/trade.ts`, pure and tested) produces them, and each chip carries a **patch** rather than a key so a filter made of several fields drops as a unit — clearing a date preset takes the custom range with it, and clearing either end of that range takes the "custom" preset. A collapsed panel reading "Filters (3)" is the reason a short list gets mistaken for missing trades.
- **Open-trade age** beside the Open badge (`durationLabel(entry, now)`), because "Open" alone says nothing about a position that has been running a week. "Now" is `zonedNow(tz)` — the same naive wall-clock basis the stored trade times use.

**Trades table — ServiceNow-style inline list edit.** Hovering a row reveals a pencil in each editable cell (double-click the cell works too); it turns that one cell into an input/select, and Enter (text) or picking an option (select) commits. The editable set is the **metadata** columns only — Symbol, Market, Direction, Grade, Status — never the computed P&L/RR figures, which stay behind the form. The renderer is a plain `inlineCell(...)` *function*, not a nested `<Component>`: a component defined inside render gets a fresh identity every pass and would remount the open editor mid-keystroke, blurring it — a function returning elements reconciles normally. Each commit routes through the same `onBulkEdit(ids, patch, label)` the selection bar uses (single-row batch), so the trade is **replaced not mutated** and `computeTrade`'s `WeakMap` cache re-derives — editing Direction re-signs P&L, editing Status flips open/closed, both correctly. Inline editing is disabled when no `onBulkEdit` is wired (the component tests exercise both paths).

## Styling

No CSS framework, no CSS modules. `APP_CSS` is a single module-scope template string of **theme-independent** CSS, all colours as `var(--token)`. The 12 themes in `THEMES` each inject their own token set. Kept at module scope so a multi-thousand-character string is built once at import, not on every render.

Colour semantics are strict:

- **green / red mean P&L. Nothing else.**
- `--accent` is the neutral brand colour, used wherever something needs emphasis without implying profit or loss.
- `--accent-2` is a secondary accent for grading and highlights.

Fonts (Inter, Space Grotesk, JetBrains Mono) are self-hosted via `@fontsource` imports in `main.jsx`. **Never add a remote `@import`** — the packaged app runs offline and would silently fall back to system fonts.

## Charts

`Charts.tsx` holds every Recharts component and is pulled in with `React.lazy` via `lazyChart()` in App.tsx, keeping ~300kB of charting out of the initial bundle. Once the app has loaded, an idle-time effect in App warms the chunk (`import("./Charts")` under `requestIdleCallback` — the same specifier `lazyChart` uses, so Vite reuses one chunk): a session restored onto a chartless tab then doesn't pay the download on its first visit to Dashboard or Analytics. While the chunk loads, each chart's Suspense fallback is a `.chart-loading` shimmer sized to the chart it replaces.

**Every `Bar`, `Pie` and `Area` sets `isAnimationActive={false}`, and new ones must too.** Recharts' entrance animation doesn't run to completion when the module mounts lazily, which leaves marks stuck at their zero-size first frame: bars render as nothing, pie sectors collapse to radius 0. Recharts also gates `<LabelList>` on the parent's animation having finished, so leaving animation on hides value labels even where the bars survive.

## Exports

`saveTextExport` / `saveBinaryExport` in App.tsx hide the desktop/web split — Electron gets a native Save As through `window.desktopExport`, the web build downloads a blob. Every helper resolves `{ ok, canceled?, path? }` so callers can toast without caring which ran.

**What goes *in* a report is not App.tsx's job.** `lib/report.ts` builds the documents (`reportChartData`, `reportChartsHtml`, `interactiveReportHtml`) and `lib/reportchart.ts` builds the pictures; App.tsx decides when to build one and where to save it. A report is a string, so it is testable in Node — which is why the escaping and the geometry are pinned by tests rather than by eyeballing a PDF.

- **Charts in a report can't be Recharts** — that needs a live React tree, and a file on disk has none. `reportchart.ts` emits SVG (`svgLineChart`, `svgBarChart`, `svgDonut`) with its own axis scaling: `niceStep` rounds gridlines to a 1/2/5 × power of ten, and every degenerate input a real journal produces (nothing closed, one point, a flat curve, all-zero months) renders an empty-state line instead of a `NaN` path.
- **Word gets a different rendering, on purpose.** Word's HTML importer drops inline SVG *silently* — the chart would simply be absent — so the Word path uses `htmlBarRows`, bars built from coloured table cells it can actually draw, and its "equity curve" is a bar per close measured from the starting balance. Don't unify the two paths.
- **Interactive HTML** — one self-contained file: KPI strip, the same SVG charts, and a trade table that searches, filters (direction / result / strategy) and sorts, with a count strip that re-totals net P&L and win rate over whatever is showing. No network, no libraries. Everything its script needs rides on each row as `data-*`, so the table is complete and readable with scripting off; an open trade's P&L is deliberately **blank** rather than `0`, because the sort keeps blanks last in both directions and a zero would outrank every real loss.
- **PDF** — desktop renders the report HTML in an offscreen `BrowserWindow` and calls `printToPDF` (a real PDF). Web writes the HTML into an offscreen iframe and opens the print dialog, where the user picks "Save as PDF".
- **Excel** — `xlsx` is imported on demand *inside* the exporter, not at module scope, so it stays out of the main bundle.
- **HTML / Word** — all free text goes through `escapeHtml()`, **including the values written into `data-*` attributes**. Symbols, strategy names, tags and notes are user input; interpolated raw they break the document or inject tags, and an attribute is just as reachable as a text node.
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
