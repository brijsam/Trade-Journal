# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Interactive HTML report** (Reports tab): one self-contained file — KPI
  strip, charts, and a trade table that searches, filters by direction /
  result / strategy, and sorts, with a count strip that re-totals net P&L
  and win rate over whatever is showing. No network, no libraries, opens
  offline in any browser.
- **Charts in every exported report**: equity curve, P&L by month, P&L by
  strategy, win/loss split. Built as plain SVG/HTML strings by the new
  `lib/reportchart.ts` + `lib/report.ts` — Recharts needs a live React tree
  that a file on disk doesn't have. Word gets bars drawn from coloured
  table cells instead, because its HTML importer drops inline SVG silently.
- **Searchable timezone picker**: ~400 zones ordered ascending by GMT
  offset under one sticky `+HH:MM GMT` heading per offset, searchable by
  city, region or offset (`gmt+5:30` / `+5:30` / `5:30` / `05:30`), with
  full keyboard support. Replaces the unsearchable ~400-option `<select>`.
- **Playbook performance**: each strategy's note now sits under its real
  record — trades, open count, win rate, net P&L, average RR, profit
  factor, win/loss bar, last close — plus search over names *and* note
  text, and sorting by trades / net / win rate.
- Accessibility: skip-to-content link, `<main>`/labelled `<aside>`
  landmarks, one visible `:focus-visible` ring across the app, sortable
  table headers reachable by Tab and sortable with Enter/Space, and a
  permanently-mounted `aria-live` toast region.
- **Sign-up at the login screen**: the gate now has Sign in / Create account
  tabs. Self sign-up is **off by default** — a gate anyone can register past
  protects nothing — and is turned on per journal in Settings > Security for
  a shared machine. A journal with no accounts yet can always register the
  first one.
- **Profile tab** for the signed-in user: photo (or initials), display name,
  member since, last sign-in, password change and sign out. Opened from the
  new signed-in chip in the top bar. `displayName`, `avatar` and
  `lastLoginAt` are additive fields on the stored user record; the username
  stays fixed, being what every record is keyed to.
- Trades tab: a **totals row** under the table for whatever the filter
  selected — trades shown, closed/open split, win rate, net P&L, average
  expected and actual R — spanning correctly whatever columns are hidden and
  totalling across pages, not just the visible one. Plus a **chip per active
  filter** (each removing only its own narrowing), a **sticky header**, and
  **how long each open trade has been open** beside its Open badge.
- Calendar: a week-total column beside every row of the monthly grid, best
  and worst day (each opening that day's trades), green-vs-red day counts,
  average per trading day, a Today jump, a heat-scale legend, drill-down
  from a month in the yearly grid, and a click on a day with no trades now
  opens its note instead of doing nothing.

### Changed
- Timezone offsets read `+05:30 GMT` (offset first) everywhere in the
  picker, so the grouped list lines up on the sign and climbs +01:00 →
  +01:30 → +02:00.
- The timezone list is anchored to the viewport and flips above the field
  when there is no room below — inside the scrolling settings pane it was
  being clipped mid-option.
- Trades-table selection lookups go through a `Set` rather than repeated
  array `includes`, and the root's account resolution through a `Map` —
  both were O(rows × selection/accounts) on every render.

### Tests
376 passing (up from 248): the report chart primitives and report documents
(including the exported page's own script, driven in jsdom), the display
formatters, the timezone picker's ordering/search/grouping,
`strategyPerformance`, `dayBreakdown`, `describeFilters`, the trades-table
totals row, the auth profile fields and
`changePassword`, plus component tests for the picker, the polished Playbook,
gate sign-up and the Profile tab. Coverage on `src/lib/**` is 100% lines /
~91% branches. The integration suite raises its own timeout to 20s — under
`--coverage` a full app boot can pass vitest's 5s default.

## [3.4.0] - 2026-07 — cashflow, login gate, help tab, journal grains

### Added
- Cashflow tab: deposits/withdrawals, per-account, running balance, own
  filter. Account balance = starting balance + trade P&L + net cashflow,
  folded into Dashboard and Settings so all three agree.
- Opt-in local login gate (`lib/auth.js`): PBKDF2-SHA-256 via Web Crypto,
  users kept out of the meta blob so password hashes never ride along in a
  journal backup. Zero users = gate off (backward compatible); creating the
  first account turns it on.
- Help tab: About/version, per-tab guides, keyboard shortcuts, data-privacy
  note.
- Weekly and yearly journal grains alongside the existing daily one, each
  its own note store and session filter.
- Yearly Performance chart window picker, matching the existing
  weekly/monthly ones.
- RR Distribution / Performance by Hour of Day / Trade Duration charts now
  window to the most recent N **closed trades**, not the full history.
- ServiceNow-style inline list edit expanded to Symbol/Market/Direction/
  Grade/Status with a hover-pencil affordance.

### Changed
- Journal filter moved behind a toggle button.
- Timezone picker list sorted by live GMT offset, west to east.
- Topbar clock now shows the year.
- Smaller window minimums; minimal back/forward + sidebar buttons;
  transparent chart hover; extra chart axis headroom.

### Tests
242 passing (up from 211): cashflow + auth pure logic, weekly/yearly
journal reads, `mostRecentTrades`, timezone offset sort, plus component
smoke tests for the cashflow tab, login gate and inline edit.

## [3.3.0] - 2026-07 — playbook tab, journal filters/export, rebrand

### Added
- Strategy Playbook moved from Settings onto its own tab (8 tabs now,
  Ctrl+1-8), with a per-strategy trade count.
- Journal tab gets a from/to date + note-text filter that narrows both the
  visible list and every export.
- Word (.doc) and PDF export for the journal, alongside the existing
  Markdown/CSV, sharing one `journalToHtml` pipeline with the trade
  report's Word-vs-PDF split.
- New app icon (candlestick-monitor art) replacing `build/icon.ico`.
- Weekly and Monthly Performance charts window to the last 5 periods by
  default, each with its own Last 3/5/8/12/All picker persisted to
  preferences.

### Changed
- Display name rebranded "Brij Trade Journal" → "Trade Journal"
  (`APP_NAME`, `productName`, `index.html` title, export filename
  prefixes). `package.json`'s `name` and `appId` are untouched — the
  `userData` path does not move, existing journals load unaffected.

### Tests
209 passing (191 lib + new filter/export/chart-count coverage, 23 in
`App.test.jsx` including the moved `PlaybookPanel` tests).

## [3.2.0] - 2026-07 — journal timezone, daily journal, strategy playbook

### Added
- Journal timezone setting (`settings.timezone`, IANA id): moves "now"
  (today keys, presets, calendar highlight, clock, picker prefill) without
  shifting already-stored trade times.
- Daily journal tab (`preferences.dayNotes`, shared with the calendar's
  day notes).
- Strategy playbook (`settings.strategyNotes`): free-text notes per
  strategy, surviving a strategy rename or removal.

### Fixed
- Tab/history navigation now gated on any open dialog.
- Today highlighted on calendar grids.
- Body-scroll lock unified so an out-of-order dialog close can no longer
  freeze scrolling.

## [3.1.1] - 2026 — foreground-steal fix

### Fixed
- Window opens but never comes to the foreground.

## [3.1.0] - 2026 — data safety, CI, ergonomics

### Added
- Import/backup data-safety upgrades.
- CI workflow, component smoke tests, import-direction lint rule.
- Bulk edit, screenshot compression, chart polish.
- Lightbox focus trap, daily auto-backup on desktop.

### Changed
- Form and table ergonomics improvements.

## [3.0.0] - 2026 — initial release

### Added
- Local-first trading journal (web + Electron desktop, fully offline).
- v3 data model: multi-account, fill legs, commission/swap fee split — all
  additive over 2.x journals with test-pinned legacy fallbacks.
- Sharded trade storage (24 keys), atomic writes.
- 146-test suite.

[3.4.0]: https://github.com/brijsam/Trade-Journal/compare/v3.3.0...v3.4.0
[3.3.0]: https://github.com/brijsam/Trade-Journal/compare/v3.2.0...v3.3.0
[3.2.0]: https://github.com/brijsam/Trade-Journal/compare/v3.1.1...v3.2.0
[3.1.1]: https://github.com/brijsam/Trade-Journal/compare/v3.1.0...v3.1.1
[3.1.0]: https://github.com/brijsam/Trade-Journal/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/brijsam/Trade-Journal/releases/tag/v3.0.0
