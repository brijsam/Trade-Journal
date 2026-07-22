# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/).

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
