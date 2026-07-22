# Known issues

Live defects, each pinned by a red test tagged `BUG:` where a test can reach them. `npm test` currently expects **a fully green run** — there are no `BUG:`-tagged failures outstanding. See [TESTING.md](TESTING.md).

Fixing one means deleting nothing: the test turns green on its own.

---

*(none currently open)*

---

## Fixed

### `npm run dist` failed with EPERM on this machine *(was #1)*

```
EPERM: operation not permitted, rename 'release\win-unpacked.tmp' -> 'release\win-unpacked'
```

Windows real-time protection held a handle on freshly extracted Electron files during the temp→final rename; a fresh output directory did **not** dodge it (retested — v5 through v8 all failed with brand-new dirs). Resolved 2026-07-17: the machine's owner added a Defender real-time-protection exclusion for the repo directory, and `Brij Trade Journal Setup 3.0.0.exe` built clean on the next run. The trap: this is an environment fix, not a code fix — remove the exclusion (or build on another machine without one) and the failure comes straight back. Full diagnosis in [RELEASING.md § The EPERM failure](RELEASING.md#the-eperm-failure--resolved-on-this-machine-2026-07-17).

Kept here because each one is a trap that can be walked back into. The tests that pinned them are still in the suite — untagged now, as ordinary regression guards.

### Fees were lost on CSV export → re-import *(was #1)*

A journal written before the commission/swap split carries its whole cost in `fees`; `computeTrade` reports `_commission: null` for such a trade, so the CSV export wrote `Commission,Swap,Fees` as `,,5`. On re-import `findCsvField()` matched the **first** aliased column — the present-but-empty `Commission` — and never fell through to `Fees`, so `rowsToTrades` computed `fees: "0"` and the cost silently vanished.

`findCsvField` now skips a present-but-empty match and continues to the next aliased column that actually holds a value. The trap to not walk back into: that empty-skip is what keeps the round trip lossless, but a column with a real value must still win in row order — an MT4 statement's `Commission` beats its `Fees`. Both sides are pinned: `round-trips a pre-split trade's fees…` (the untagged ex-`BUG:` test) and `round-trips a split-fee trade…`.

### Day bucketing was off by one east of UTC *(was #1 and #2)*

`isoDate()` returned a UTC day (`toISOString().slice(0, 10)`) while every caller handed it a Date built from local parts. At IST every trade closed before 05:30 filed under the previous day, each calendar cell was keyed one day off its own label (the weekly grid disagreed with the monthly grid about the same date), and `dateRangeForPreset` opened "This Month" on 30 June and "This Week" on a Saturday.

It is now formatted from local parts. `endOfDayIso` went with it: its only job was nudging the UTC date via time-of-day, which a local key ignores. See [ARCHITECTURE.md](ARCHITECTURE.md#dates) — the warning there is the thing to read before touching this again.

`preferences.dayNotes` was **not** migrated. Notes under an old UTC key stay where they were written; a key alone doesn't reveal which scheme wrote it, so a blind shift would mis-file the notes that were already correct. The journal on this machine had no notes.

### The monthly and weekly calendar grids never marked today *(found during a full regression pass)*

The daily view's focus card and the trade form's date-picker mini-calendar both marked today (`isToday`, comparing against `zonedNow(tz)`), but `dayCell` — the cell renderer shared by the weekly and monthly grids — had no such check at all. A trader looking at the month view had no visual cue for which cell was today; only a cell with trade activity stood out, for reasons unrelated to being today.

Fixed by computing one `todayKey` per `PerformanceCalendar` render (same `isoDate(zonedNow(tz))` the daily view already used) and comparing it inside `dayCell`, adding `.calendar-cell-today` when it matches. The daily view's own `isToday` now reads the same `todayKey` instead of recomputing it. Verified in both the monthly grid and the weekly grid (stepping to the week that actually contains today).

### Switching tabs or navigating history could unmount an open dialog mid-edit, losing unsaved text *(found in passing)*

Ctrl/Cmd+1..7 (tab jump) and Alt+←/→ (history) were gated on `!showForm && !viewing` only — the trade form and the trade-detail view. Every *other* dialog (a Journal or Calendar day-note editor, a ConfirmModal like "Clear All Trades" or an account delete, the strategy manager, the keyboard-shortcuts panel) sets neither flag, so either shortcut unmounted it out from under the user with no confirmation — typing a day's note and hitting Ctrl+2 by reflex silently discarded it. The comment above the tab-jump code already claimed "switching the page under an open dialog would strand unsaved edits"; it just wasn't true for anything past those first two.

Found chasing the body-scroll-lock bug below, which the same gap enables (a tab switch is one way to unmount a modal while the palette opened on top of it is still up). Fixed with `useOpenDialogCount()` — every `Modal` instance (which is every one of the dialogs above) increments a shared count on mount and decrements on unmount; both shortcuts now also require `openDialogCount === 0`. Deliberately a *second* counter, not a reuse of `bodyScrollLockCount` below: `CommandPalette` holds that lock too (it's allowed to open over any modal) but isn't a dialog whose edits navigation could strand, so it must not gate navigation the same way.

### Closing a modal and the command palette out of order could freeze scrolling for the rest of the session

`Modal` and `CommandPalette` each froze `document.body.style.overflow` independently: on open, snapshot the current value and set `"hidden"`; on close, restore the snapshot. The palette is deliberately allowed to open **on top of** any modal (`.palette-overlay`'s `z-index: 250` sits above `.modal-overlay`'s `100`, specifically so Ctrl/Cmd+K works from inside a dialog) — but nothing stopped the *modal* from closing first while the palette stayed open on top of it, e.g. opening a note in Journal or Calendar, pressing Ctrl+K, switching tabs (which unmounts the note modal without going through its own close button), then closing the palette. The modal's cleanup ran first and restored its snapshot (`""`), then the palette's cleanup ran and restored *its* snapshot — which had recorded `"hidden"`, because the modal was still holding the lock when the palette opened. The body was left at `overflow: hidden` with no dialog left open to blame: no scrollbar, mouse wheel dead, scrollbar drag dead, on every tab, until reload.

Replaced both independent locks with one reference-counted `useBodyScrollLock()`: a module-level counter increments per open dialog and decrements per close, and the DOM is only touched at the 0→1 and 1→0 transitions, using the snapshot taken by whichever dialog was *first* to lock. Any close order is now safe. The `document.body.style.overflow === "hidden"` read in the trades-table row-cursor listener (see [ARCHITECTURE.md](ARCHITECTURE.md)) needed no change — the value it reads still means exactly "something is open."

### The restored calendar cursor sat one day behind its key west of UTC *(found in passing)*

`preferences.calendarCursor` stores a bare day key (`"2026-07-17"`), and the calendar restored it with `new Date(key)` — which the Date constructor parses as **UTC midnight**. West of the meridian that instant is still the evening of the 16th, so the daily view reopened on the wrong day, one behind its own key. East of UTC it happened to work, which is why the IST-pinned suite never caught it. It now restores through `parseLocalInputValue`, which reads the key as local midnight. Found while wiring the journal timezone setting (v3.2); the trap is the same one `isoDate` documents — a bare date string through `new Date()` is UTC, not local.

### The dashboard obeyed the Trades-tab filter *(reported separately)*

`<DashboardPanel trades={filtered}>` while the ticker directly above it used `scopedTrades`. Setting "Open Trades" on the Trades tab and walking to the Dashboard showed $0.00 and 0 trades under a ticker still reading the real balance — indistinguishable from data loss, with no filter control on that screen to explain it. The dashboard now takes `scopedTrades`.

Analytics still takes `filtered` **on purpose** — it is the deep-dive panel. Reports asks for the scope explicitly. Calendar was already scoped. Don't "make them consistent".

### Trade ids could be issued twice *(reported separately)*

`nextTradeId` derived the next id from the live trade list, so deleting a trade freed its number while the Undo toast still held the record. Minting a trade in that window and then hitting Undo left two trades sharing an id — one shard entry, one React key, one screenshot key, and an edit to either rewriting both. Ids now come from a persisted high-water counter (`tradeSeq` in meta). See [ARCHITECTURE.md](ARCHITECTURE.md#trade-ids).

---

## Non-issues, recorded so they aren't "fixed" again

- **`xlsx` resolves to a `cdn.sheetjs.com` tarball URL, not a semver range** — deliberate. The npm registry package is abandoned at 0.18.5 with two unfixed high advisories (prototype pollution + ReDoS, both parse-side; this app only writes). SheetJS publishes fixed builds only through its own CDN, so `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"` is the correct form. `npm update` will never bump it — upgrade by installing the next `https://cdn.sheetjs.com/xlsx-<ver>/xlsx-<ver>.tgz`. Reverting to `^0.18.5` reintroduces the `npm audit` failure.
- **`storage.get(META_KEY, false)`** — App.tsx passes a second argument that `storage.ts` ignores (typed as an accepted-but-unused `...rest` param specifically so this doesn't need cleaning up to typecheck). Dead but harmless, many call sites.
- **`settings.startingBalance`** — mirrored from `accounts[0]` and read by nothing in v3. It exists so a 2.x build can still read a v3 journal. Removing it strands users who roll back.
- **The login gate is a soft gate, not disk encryption** — deliberate, and said so in the UI. `lib/auth.ts` stores only a PBKDF2 salt+hash; the journal's trade files stay plain on disk. It keeps a casual second person out of the *running app*, nothing more. Do not "harden" it into a false promise of at-rest encryption — that would need the whole storage layer encrypted against a key the app can't hold locally without also storing. The gate is also **opt-in** (no users configured = no gate): don't make it mandatory, and don't move the user store into the meta blob — `AUTH_KEY` is separate precisely so password hashes never land in a journal backup.
- ~~**`release/`, `release-v2..v4/` are committed**~~ — resolved: `.gitignore` now covers `release/` and `release-*/`, and the staged installer binaries were removed from the git index before the first commit (working copies untouched). See [RELEASING.md § Repo hygiene](RELEASING.md#repo-hygiene).
