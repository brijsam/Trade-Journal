# Wrapping Brij Trade Journal in Electron → real Windows .exe

This adds a genuine desktop shell around the exact same app you already
have running. Your trade data will live in real local files instead of the
browser's storage.

## 0. If you haven't already

Make sure the browser version from before is in place: `src/App.jsx`,
`src/lib/storage.js` (this step **replaces** that file — see below),
`src/index.css`. If you did the earlier VS Code step, you're already there.

## 1. Copy these files into your project

- `electron/main.cjs`  → new folder `electron/` in your project root
- `electron/preload.cjs` → same folder
- `src/lib/storage.js` → **overwrite** your existing one (this version
  auto-detects Electron and uses real files on disk when running inside it,
  and falls back to the IndexedDB version automatically when you just run
  `npm run dev` in a normal browser tab — so both workflows keep working)

## 2. Install the extra dev dependencies

```bash
npm install --save-dev electron electron-builder concurrently wait-on cross-env
```

## 3. Edit `package.json`

Add `"main"` at the top level, and add/merge these into your existing
`"scripts"` (keep whatever you already have — just add the two new ones):

```json
{
  "main": "electron/main.cjs",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "electron:dev": "concurrently -k \"npm:dev\" \"wait-on tcp:5173 && cross-env NODE_ENV=development electron .\"",
    "dist": "npm run build && electron-builder"
  }
}
```

Then add this **new top-level key** (a sibling of `"scripts"`,
`"dependencies"`, etc.) — this is electron-builder's config, it doesn't
exist in your file yet:

```json
"build": {
  "appId": "com.brij.tradejournal",
  "productName": "Brij Trade Journal",
  "files": ["dist/**/*", "electron/**/*"],
  "directories": {
    "buildResources": "build",
    "output": "release"
  },
  "win": {
    "target": "nsis",
    "icon": "build/icon.ico"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true
  }
}
```

(`output: "release"` keeps electron-builder's output separate from Vite's
own `dist/` build folder — otherwise they'd collide.)

## 4. Edit `vite.config.js`

Add `base: "./"` so the built app uses relative asset paths — required for
Electron to load `dist/index.html` directly off disk:

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
});
```

## 5. Add an app icon

Electron-builder needs `build/icon.ico` (256×256 recommended) to exist —
it'll fail without it. Create a `build/` folder in your project root and
drop an `.ico` file there named `icon.ico`. If you only have a PNG/logo,
convert it for free at a site like icoconvert.com or convertio.co.

## 6. Run it

**Dev mode** (hot-reload, DevTools available, easiest for iterating):

```bash
npm run electron:dev
```

**Build the actual installer:**

```bash
npm run dist
```

This runs `vite build` then `electron-builder`. When it finishes, look in
the `release/` folder for something like:

```
release/Brij Trade Journal Setup 1.0.0.exe
```

Run that installer — it installs to Program Files (or wherever the user
picks), creates a Start Menu entry and Desktop shortcut automatically, and
from then on launches as a fully offline desktop app. No browser, no dev
server, no internet connection required.

## Notes

- **Build on Windows.** electron-builder can cross-build a Windows target
  from macOS/Linux via Wine, but it's slower and fiddlier to set up than
  just running `npm run dist` directly on a Windows machine — which you
  already have, based on your terminal.
- **Where your data lives once installed:**
  `C:\Users\<you>\AppData\Roaming\Brij Trade Journal\storage\` — one JSON
  file per storage key (trade shards, and one per trade's screenshots).
  Back this folder up like you would any other important local folder, or
  keep using the in-app Settings → Download Backup as a portable copy.
- **PowerShell script errors** you hit earlier can also show up with
  `electron-builder` — if so, the same fix applies: run the command from
  Command Prompt, or `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`.
