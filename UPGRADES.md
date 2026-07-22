# Upgrade tracker — public-product grade

Working doc for the 6-batch push from "~4/5 prosumer app" to "5/5 public-product
grade" (see the maturity check that produced this list). Each batch is meant to
be done **in its own chat window**, one at a time, in order. This file tracks
status only — the actual per-batch instructions live below; do NOT implement
from this file directly without opening a fresh session per batch as planned.

**Status legend:** ⬜ not started · 🟨 in progress · ✅ done (date + commit)

**Recommended order:** #2 → #1 → #5 → #3 → #6 → #4 (quick legal/safety wins
first, TypeScript last — it's the biggest effort).

---

## Global rules (apply to EVERY batch)

- Verify = `npm run lint` + `npm test` green before calling a batch done.
  Baseline at the time this list was written: **242 tests pass**.
- One-way imports: `lib/*`, `Charts.jsx` must never import `App.jsx`
  (eslint's `no-restricted-imports` enforces this — don't work around it).
- Pure logic → `lib/` with a test. Anything touching `window`, `document` or
  `storage` → `App.jsx`.
- Update docs unasked: CLAUDE.md, ARCHITECTURE.md, TESTING.md, README.md,
  KNOWN_ISSUES.md as relevant. Bump the `npm test` count everywhere it's
  quoted (CLAUDE.md, TESTING.md, README.md) if the count changes.
- Don't touch `name: "tradingjournal"`, `build.appId`, `build.publish: null`
  in package.json — see RELEASING.md for why.
- Mark this file's status line ✅ when a batch lands (date + short commit hash).

---

## ✅ Batch #1 — React ErrorBoundary (2026-07-22)

**Why:** one render throw currently white-screens the whole app; no recovery
path exists at the React level (only the boot-time `loadError` screen covers
a *storage* read failure, not a render throw).

**Do:** add a class `ErrorBoundary` (the one class component this codebase
needs — everything else is functions). Needs `componentDidCatch` +
`getDerivedStateFromError`. Wrap the root render in `App.jsx`. Fallback UI
should reuse the existing `BOOT_CSS` / boot-error screen styling (grep
`boot-error` in App.jsx) with a Reload button (`window.location.reload()`)
and the error message. Must **not** disable persistence or wipe any data —
it's a render-layer catch, not a storage-layer one.

**Files:** `src/App.jsx` (new component + wrap), possibly a new smoke test.

**Accept:** a child that throws during render shows the fallback screen, not
a blank page; Reload recovers; `console.error` logs the error (don't
swallow it silently). Add a test: render a component that throws inside
`ErrorBoundary`, assert the fallback text appears.

**Gotcha:** keep it fully offline — no external error-reporting calls.

---

## ✅ Batch #2 — LICENSE (2026-07-22)

**Why:** the app ships as a signed ~108MB Windows installer with **no
license file and no `license` field in package.json** — legally undefined
terms for anyone who receives that .exe.

**Do:** pick a license (MIT is the common default for a solo project; this
is the owner's call, not a technical one — confirm before proceeding.
Proprietary/all-rights-reserved is also valid if this isn't meant to be
open-source). Add a `LICENSE` file (owner name, year). Set `"license"` in
`package.json` to match. Add a short License section/line to README.md.

**Files:** `LICENSE` (new), `package.json`, `README.md`.

**Accept:** `LICENSE` present at repo root, `package.json`'s `license`
field set and matching, README references it.

**Gotcha:** this is a decision to confirm with the owner first, not
something to default silently.

---

## ✅ Batch #3 — Root-App integration test (2026-07-22)

**Why:** the save/load/shard/boot loop (24-shard trade storage, separate
meta vs. trade save effects, `loadError` fail-safe, `writtenShardsRef`
diffing) is only ever verified by hand. Component tests cover individual
panels in isolation, not the persistence wiring that holds a real journal
together.

**Do:** new test file (e.g. `src/App.integration.test.jsx`, jsdom
environment). Mock `./lib/storage` (`vi.mock`) with an in-memory
`get/set/delete/list`. Assert at minimum:
- boot reads meta + shards from the mock store → trades render;
- adding/editing a trade writes only the changed shard, not all 24
  (`writtenShardsRef` behavior);
- a storage read failure sets `loadError` and disables saving — shards are
  **not** overwritten with an empty journal;
- meta and trade saves are genuinely separate effects (a preference/theme
  change alone doesn't rewrite all 24 trade shards).

**Files:** new test file only; add a minimal testability seam in App.jsx
only if there's truly no way to drive it otherwise — keep any such change
as small as possible.

**Accept:** new tests green, test count rises, TESTING.md's coverage
matrix and counts updated to match.

**Gotcha:** the suite is TZ-pinned (`TZ=Asia/Kolkata`) for a reason — see
TESTING.md; don't unpin it. Storage is async/promise-based throughout.
Don't weaken production code just to make it easier to test.

---

## 🟨 Batch #4 — TypeScript (biggest effort — do LAST) — lib done, App.jsx deferred (2026-07-22)

**Why:** zero static type safety over a ~5.2k-line `App.jsx` and a
~1.1k-line `lib/trade.js`. Highest-leverage improvement for a codebase this
size; also the most work.

**Do:** incremental, not a big-bang rewrite. Two viable starting points —
pick one and note the choice here:
  (a) add `tsconfig.json` with `allowJs` + `checkJs` and JSDoc-type the
      existing `.js`/`.jsx` files in place (lowest risk, no renames), or
  (b) migrate `lib/*.js → .ts` file by file, starting with the purest ones
      (`format.js` → `trade.js` → `auth.js`), leaving `App.jsx` for last or
      keeping it `.jsx` with JSDoc types.
Add `tsc --noEmit` as a lint/CI step either way.

**Choice made: (b).** `git mv`'d `lib/format.js`, `lib/auth.js`, `lib/trade.js`
to `.ts` (history preserved) and typed them for real — domain types (`Trade`,
`ComputedTrade`, `Settings`, `Preferences`, `Account`, `Transaction`,
`AuthUser`, …) live at the top of `trade.ts`/`auth.ts`. `strict: true`.
Boundary functions that coerce "whatever's on disk" (`mergeSettings`,
`normalizeAccounts`, `normalizeUsers`, `rowsToTrades`, `computeTrade`'s
input, …) take `unknown` on purpose — that's their actual job — rather than
being forced into the domain types they produce. No import-path edits were
needed anywhere: imports in this codebase are already extension-less.
`App.jsx`/`Charts.jsx` **stay `.jsx` for now** (`allowJs: true, checkJs:
false` includes them in the program un-checked) — a future session picks
between JSDoc-typing them in place or a `.tsx` migration; either way
`src/vite-env.d.ts` (added this session) already has the ambient
`__APP_VERSION__` declaration both paths need.

**Files:** `tsconfig.json` (new), `src/vite-env.d.ts` (new),
`src/lib/format.ts`/`auth.ts`/`trade.ts` (renamed from `.js`, typed),
`eslint.config.js` (added `typescript-eslint`, extended the one-way-import
rule to `lib/**/*.ts`), `package.json` (added `typescript` +
`typescript-eslint` devDeps, `lint` now chains `tsc --noEmit`, new
`typecheck` script), `.github/workflows/ci.yml` (comment only — `npm run
lint` already carries `tsc` through the existing lint step).

**Accept:** `tsc --noEmit` clean, all tests still pass (248/248), no runtime
behavior change — verified `npm run build` still code-splits `Charts.jsx`
into its own chunk, and the dev server renders/behaves identically in the
browser. This is a types-only pass, not a refactor.

**Gotcha:** don't break the one-way import rule or the lazy `Charts.jsx`
code-split boundary. `__APP_VERSION__` is a Vite-injected global (declared
in eslint.config.js **and** now `src/vite-env.d.ts` for `tsc`) — it needs an
ambient `.d.ts` declaration under option (a)/(b). This batch is large enough
to reasonably split across more than one session — lib first (done),
App.jsx later (not started).

---

## ⬜ Batch #5 — Coverage tooling + threshold

**Why:** actual test coverage is currently unknown and unenforced — no
tooling reports it, nothing in CI gates on it.

**Do:** add `@vitest/coverage-v8` (or equivalent), a `test:coverage`
script, and coverage thresholds scoped sensibly — start with `lib/**`
(the pure-logic layer, where coverage is both meaningful and achievable)
rather than a blanket threshold across `App.jsx`'s UI code. Add a coverage
step to `.github/workflows/ci.yml`.

**Files:** `package.json`, vitest/vite config, `.github/workflows/ci.yml`,
`.gitignore` (add `coverage/`), `TESTING.md`.

**Accept:** `npm run test:coverage` produces a report; CI enforces the
threshold; `coverage/` is gitignored, not committed.

**Gotcha:** don't set a global threshold high enough to block CI on
untestable UI surface in `App.jsx` — scope it to where the value actually
is (`lib/**`).

---

## ✅ Batch #6 — Releases: tags + CHANGELOG + GitHub releases (2026-07-22)

**Why:** git tags stop at `v3.1.1`; versions 3.2, 3.3 and 3.4 were released
(per package.json bumps) but never tagged. No `CHANGELOG.md` exists, no
GitHub Releases with notes.

**Do:** add `CHANGELOG.md` in Keep-a-Changelog format, backfilling entries
for 3.2 → 3.4 from git log / commit messages. Backfill git tags `v3.2.0`,
`v3.3.0`, `v3.4.0` on the correct existing commits (don't rewrite history —
tag what's already there). Create matching GitHub Releases, optionally
attaching the built `.exe`. Add "tag + changelog entry" as an explicit step
in `RELEASING.md`'s checklist going forward.

**Files:** `CHANGELOG.md` (new), `RELEASING.md`, git tags (annotated,
pushed), GitHub Releases (via `gh release create` or the UI).

**Accept:** `CHANGELOG.md` current through 3.4.0; `v3.2.0`/`v3.3.0`/`v3.4.0`
tags exist and are pushed; RELEASING.md's checklist includes this step for
future releases.

**Gotcha:** keep `build.publish: null` — distribution stays manual, do not
wire up `electron-updater`. Tag existing commits; never force-rewrite
history to "fix" past releases.

---

## After all 6

Re-run a full maturity check against the same rubric used originally
(tests, audit, CI, lint, robustness markers, a11y, docs, license, error
handling, type safety, coverage, release hygiene) to confirm the move from
~4/5 to 5/5.
