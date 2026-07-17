# Releasing

Distribution is a **manual download** of an NSIS installer built on this machine. There is no auto-update and no publish target, by decision.

## Checklist

1. `npm run lint` — clean.
2. `npm test` — fully green expected (no `BUG:`-tagged failures outstanding, see [KNOWN_ISSUES.md](KNOWN_ISSUES.md)). Any failure blocks the release.
3. Drive the app (`npm run electron:dev`) — the shell has no automated coverage.
4. Bump `version` in `package.json`. **That is the only field a release touches.**
5. `npm run dist` → `release/Brij Trade Journal Setup <version>.exe`.
6. Install the built exe and confirm an existing journal still loads.

## Rules that must not be broken

### `version` is the only field a release bumps

`vite.config.js` injects it as `__APP_VERSION__`:

```js
define: { __APP_VERSION__: JSON.stringify(pkg.version) }
```

Settings > About reads that, so it cannot drift. It used to be typed into App.jsx by hand and did drift — the About panel read 2.1 while the installer built 2.1.0. `__APP_VERSION__` is declared as a global in `eslint.config.js` because it never exists as a real binding.

### `name: "tradingjournal"` is load-bearing

**Electron derives `userData` from `package.json`'s `name`** — not from `build.productName`. The journal lives at `%APPDATA%\tradingjournal\storage` regardless of what the product is called. `productName` only renames the executable and the installer.

Changing `name` strands every existing trade. Leave `name` and `build.appId` alone.

`migrateLegacyStorage()` in `electron/main.cjs` is the safety net for builds that already shipped under other names — a one-time copy *in* from `brijtradejournal`, `Brij Trade Journal` and `Trading Journal` when the current storage dir is empty. It is a backstop, not a licence to rename.

### `build.publish: null` is deliberate

Without it, electron-builder detects the git remote and writes `latest.yml` update metadata **regardless of publish state** — see `getPublishConfigsForUpdateInfo` in `app-builder-lib`. Setting `publish: null` makes `getPublishConfigs` return null, so no `latest.yml` is emitted.

The user chose manual distribution over wiring up `electron-updater`. Do not "helpfully" re-add a publish config or an updater.

### Build on Windows

electron-builder can cross-build a Windows target from macOS/Linux via Wine, but it is slower and fiddlier than running `npm run dist` on the Windows box that already exists.

`build/icon.ico` must exist (256×256) or the build fails.

## The EPERM failure

`npm run dist` on this machine intermittently dies with:

```
EPERM: operation not permitted, rename 'release\win-unpacked.tmp' -> 'release\win-unpacked'
```

Windows real-time protection grabs a handle on freshly extracted Electron files (`app.asar`, `default_app.asar`) during the temp→final rename.

**A fresh output directory does not dodge it.** Retested with `--config.directories.output=release-vN` across four brand-new dirs — all four failed identically. Stale leftovers were never the cause; the lock lands on the newly extracted files inside `win-unpacked.tmp`. The lock is transient: `rm -rf release-vN` succeeds once the builder process fully exits. No reboot needed.

**The fix is a Windows Defender real-time-protection exclusion for the repo directory.** That is a security setting the machine's owner must change themselves — Claude will not touch it. Until then, no installer can be produced here.

Last good installer: `release-v2\Brij Trade Journal Setup 2.0.0.exe`. `package.json` is at **3.0.0**, which has never been built.

## Where user data lives

```
%APPDATA%\tradingjournal\storage\      one JSON file per key
%APPDATA%\tradingjournal\window-state.json
```

Keys: `brij-tj-meta-v1` (settings, strategies, preferences, theme), `brij-tj-shard-0..23` (trades), `brij-tj-shots-<trade-id>` (screenshots). Back this folder up like any other important local folder, or use Settings → Download Backup for a portable copy.

A release must never change the shard hash, `SHARD_COUNT`, or the key prefixes without a migration — every existing trade would be looked for in the wrong place. See [ARCHITECTURE.md](ARCHITECTURE.md#sharding).

## Repo hygiene

Build output is never tracked: `.gitignore` covers `dist`, `release/` and `release-*/` (the latter catches the throwaway output dirs from the EPERM retesting above). The installers that used to sit in the git index were unstaged before the first commit, so they never entered history — keep it that way. Built installers stay on disk under `release*/` for manual distribution; they just don't belong in git.
