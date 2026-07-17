# Known issues

Live defects, each pinned by a red test tagged `BUG:` where a test can reach them. `npm test` currently expects **a fully green run** — there are no `BUG:`-tagged failures outstanding. See [TESTING.md](TESTING.md).

Fixing one means deleting nothing: the test turns green on its own.

---

## 1. `npm run dist` fails with EPERM on this machine

**Severity: blocks Windows releases.** Not test-covered — it is an environment problem.

```
EPERM: operation not permitted, rename 'release\win-unpacked.tmp' -> 'release\win-unpacked'
```

Windows real-time protection holds a handle on freshly extracted Electron files during the temp→final rename. A fresh output directory does **not** dodge it (retested — v5 through v8 all failed with brand-new dirs). The lock is transient: the directory deletes fine once the builder process exits.

**Fix:** a Windows Defender real-time-protection exclusion for the repo directory. That is a security setting the machine's owner must change themselves — Claude will not make it. Until then no installer can be built here; the last good one is `release-v2\Brij Trade Journal Setup 2.0.0.exe`, while package.json is at 3.0.0.

---

## Fixed

Kept here because each one is a trap that can be walked back into. The tests that pinned them are still in the suite — untagged now, as ordinary regression guards.

### Fees were lost on CSV export → re-import *(was #1)*

A journal written before the commission/swap split carries its whole cost in `fees`; `computeTrade` reports `_commission: null` for such a trade, so the CSV export wrote `Commission,Swap,Fees` as `,,5`. On re-import `findCsvField()` matched the **first** aliased column — the present-but-empty `Commission` — and never fell through to `Fees`, so `rowsToTrades` computed `fees: "0"` and the cost silently vanished.

`findCsvField` now skips a present-but-empty match and continues to the next aliased column that actually holds a value. The trap to not walk back into: that empty-skip is what keeps the round trip lossless, but a column with a real value must still win in row order — an MT4 statement's `Commission` beats its `Fees`. Both sides are pinned: `round-trips a pre-split trade's fees…` (the untagged ex-`BUG:` test) and `round-trips a split-fee trade…`.

### Day bucketing was off by one east of UTC *(was #1 and #2)*

`isoDate()` returned a UTC day (`toISOString().slice(0, 10)`) while every caller handed it a Date built from local parts. At IST every trade closed before 05:30 filed under the previous day, each calendar cell was keyed one day off its own label (the weekly grid disagreed with the monthly grid about the same date), and `dateRangeForPreset` opened "This Month" on 30 June and "This Week" on a Saturday.

It is now formatted from local parts. `endOfDayIso` went with it: its only job was nudging the UTC date via time-of-day, which a local key ignores. See [ARCHITECTURE.md](ARCHITECTURE.md#dates) — the warning there is the thing to read before touching this again.

`preferences.dayNotes` was **not** migrated. Notes under an old UTC key stay where they were written; a key alone doesn't reveal which scheme wrote it, so a blind shift would mis-file the notes that were already correct. The journal on this machine had no notes.

### The dashboard obeyed the Trades-tab filter *(reported separately)*

`<DashboardPanel trades={filtered}>` while the ticker directly above it used `scopedTrades`. Setting "Open Trades" on the Trades tab and walking to the Dashboard showed $0.00 and 0 trades under a ticker still reading the real balance — indistinguishable from data loss, with no filter control on that screen to explain it. The dashboard now takes `scopedTrades`.

Analytics still takes `filtered` **on purpose** — it is the deep-dive panel. Reports asks for the scope explicitly. Calendar was already scoped. Don't "make them consistent".

### Trade ids could be issued twice *(reported separately)*

`nextTradeId` derived the next id from the live trade list, so deleting a trade freed its number while the Undo toast still held the record. Minting a trade in that window and then hitting Undo left two trades sharing an id — one shard entry, one React key, one screenshot key, and an edit to either rewriting both. Ids now come from a persisted high-water counter (`tradeSeq` in meta). See [ARCHITECTURE.md](ARCHITECTURE.md#trade-ids).

---

## Non-issues, recorded so they aren't "fixed" again

- **`storage.get(META_KEY, false)`** — App.jsx passes a second argument that `storage.js` ignores. Dead but harmless, many call sites.
- **`settings.startingBalance`** — mirrored from `accounts[0]` and read by nothing in v3. It exists so a 2.x build can still read a v3 journal. Removing it strands users who roll back.
- ~~**`release/`, `release-v2..v4/` are committed**~~ — resolved: `.gitignore` now covers `release/` and `release-*/`, and the staged installer binaries were removed from the git index before the first commit (working copies untouched). See [RELEASING.md § Repo hygiene](RELEASING.md#repo-hygiene).
