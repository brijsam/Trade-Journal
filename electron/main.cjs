const { app, BrowserWindow, ipcMain, dialog, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");

const isDev = !app.isPackaged;

/* SINGLE-INSTANCE LOCK
   Two copies of the app would be two independent writers over the same JSON
   shard files. Atomic rename protects a single write from tearing, but not two
   processes racing to replace the same shard — last writer wins and the other's
   trades vanish. Hold a lock; a second launch just focuses the running window. */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      // Same foreground-steal as the initial launch — this is exactly the path
      // a user hits every time they double-click an already-running instance
      // that never made it to the front the first time.
      app.focus({ steal: true });
    }
  });
}

/* All trade data + screenshots live here:
   C:\Users\<you>\AppData\Roaming\tradingjournal\storage

   Note the folder is "tradingjournal", not the product name. Electron derives
   userData from app.getName(), which reads package.json's `name` field —
   electron-builder's build.productName only renames the executable and the
   installer. So renaming the product does NOT move the data. Verified on a real
   packaged run: the app writes to %APPDATA%\tradingjournal regardless of
   productName. Changing `name` in package.json is what would strand a journal. */
const storageDir = path.join(app.getPath("userData"), "storage");
fs.mkdirSync(storageDir, { recursive: true });

/* SAFETY NET FOR EARLIER BUILDS
   Older builds shipped under different package `name` values, leaving journals
   behind in sibling userData folders. If our storage is empty but one of those
   holds data, copy it across once, so an upgrade never looks like a wiped
   journal. Best-effort — a failure just leaves the user starting fresh, no
   worse than not trying. */
function migrateLegacyStorage() {
  try {
    if (fs.readdirSync(storageDir).some((f) => f.endsWith(".json"))) return;
    const parent = path.dirname(app.getPath("userData"));
    for (const legacyName of ["brijtradejournal", "Brij Trade Journal", "Trading Journal"]) {
      const legacyDir = path.join(parent, legacyName, "storage");
      if (legacyDir === storageDir) continue;
      if (fs.existsSync(legacyDir) && fs.readdirSync(legacyDir).some((f) => f.endsWith(".json"))) {
        for (const f of fs.readdirSync(legacyDir)) {
          fs.copyFileSync(path.join(legacyDir, f), path.join(storageDir, f));
        }
        console.log(`Migrated storage from "${legacyName}"`);
        return;
      }
    }
  } catch (err) {
    console.error("Legacy storage migration skipped", err);
  }
}
migrateLegacyStorage();

function keyToFile(key) {
  return path.join(storageDir, `${encodeURIComponent(key)}.json`);
}

/* AUTO-BACKUP
   A silent snapshot of the whole storage directory into
   userData\backups\<YYYY-MM-DD>\, taken once per local calendar day, on
   launch. Launch, not quit: a quit-time copy races process exit, while at
   launch the snapshot simply captures the journal as this session found it —
   whatever a later crash or bad write does, yesterday's state survives.

   The copy lands in a .tmp directory renamed into place, so a killed launch
   can never leave a half-written folder that looks like a valid backup. Only
   the newest KEEP_BACKUPS days are kept. Restore is manual by design: copy the
   files back into storage\ with the app closed. Best-effort — a failure logs
   and changes nothing. */
const backupsDir = path.join(app.getPath("userData"), "backups");
const KEEP_BACKUPS = 5;
async function autoBackupStorage() {
  try {
    const files = (await fsp.readdir(storageDir)).filter((f) => f.endsWith(".json"));
    if (!files.length) return;
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const dest = path.join(backupsDir, day);
    try { await fsp.access(dest); return; } catch { /* no snapshot today yet */ }
    const tmp = `${dest}.tmp`;
    await fsp.rm(tmp, { recursive: true, force: true });
    await fsp.mkdir(tmp, { recursive: true });
    await Promise.all(files.map((f) => fsp.copyFile(path.join(storageDir, f), path.join(tmp, f))));
    await fsp.rename(tmp, dest);
    const days = (await fsp.readdir(backupsDir)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    await Promise.all(days.slice(0, Math.max(0, days.length - KEEP_BACKUPS))
      .map((d) => fsp.rm(path.join(backupsDir, d), { recursive: true, force: true })));
    console.log(`Auto-backup written: backups\\${day} (${files.length} files)`);
  } catch (err) {
    console.error("auto-backup skipped", err);
  }
}

/* These handlers are the renderer's only path to disk, and they run on the main
   process — the same thread that services window and IPC events. They use the
   async fs API throughout: the synchronous calls they replaced stalled the whole
   main process, and a single save writes every shard, so those stalls stacked up.

   Writes go to a temp file and are renamed into place. rename is atomic on the
   same volume, so a crash or power loss mid-write leaves the previous shard
   intact instead of a truncated, unparseable one. */
async function readIfExists(file) {
  try {
    return await fsp.readFile(file, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/* ON-DISK FORMAT
   Every value arriving here is already a JSON string built by the renderer.
   Older builds re-wrapped it as {"value": "<json>"}, escaping an already
   serialised payload; values are now written verbatim.

   The win is mostly CPU, not disk. Measured on this data: a 200-trade shard is
   ~17% smaller unwrapped, but a screenshot record is unchanged — base64 has no
   characters JSON needs to escape, so the wrapper only ever added two quotes to
   the files that are actually large. What it did cost was a full wrap-and-unwrap
   of the whole payload on every save and load: ~17ms each way on an 8MB
   screenshot record, for a string that was already valid JSON.

   Legacy files stay readable and are rewritten in the new format whenever that
   key is next saved, so there is no migration step and no flag day.

   The prefix test below is exact rather than heuristic. A legacy file is always
   literally `{"value":"...`, while current payloads are a shard array (`[`), the
   meta record (`{"settings":`) or a screenshot record (`{"screenshots":`) — none
   can collide. It also keeps the common path free of a throwaway parse. */
const LEGACY_WRAPPER_PREFIX = '{"value":"';
function unwrapStored(raw) {
  if (!raw.startsWith(LEGACY_WRAPPER_PREFIX)) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.value === "string") return parsed.value;
  } catch { /* fall through and hand back exactly what is on disk */ }
  return raw;
}

ipcMain.handle("storage:get", async (_evt, key) => {
  try {
    const raw = await readIfExists(keyToFile(key));
    if (raw == null) return null;
    return { key, value: unwrapStored(raw), shared: false };
  } catch (err) {
    console.error("storage:get failed", key, err);
    return null;
  }
});

ipcMain.handle("storage:set", async (_evt, key, value) => {
  const file = keyToFile(key);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await fsp.writeFile(tmp, String(value), "utf-8");
    await fsp.rename(tmp, file);
    return { key, value, shared: false };
  } catch (err) {
    console.error("storage:set failed", key, err);
    await fsp.rm(tmp, { force: true }).catch(() => {});
    return null;
  }
});

ipcMain.handle("storage:delete", async (_evt, key) => {
  try {
    await fsp.rm(keyToFile(key), { force: true });
    return { key, deleted: true, shared: false };
  } catch (err) {
    console.error("storage:delete failed", key, err);
    return null;
  }
});

ipcMain.handle("storage:list", async (_evt, prefix) => {
  try {
    const files = await fsp.readdir(storageDir);
    const keys = files
      .filter((f) => f.endsWith(".json"))
      .map((f) => decodeURIComponent(f.replace(/\.json$/, "")))
      .filter((k) => !prefix || k.startsWith(prefix));
    return { keys, prefix, shared: false };
  } catch (err) {
    console.error("storage:list failed", err);
    return { keys: [], prefix, shared: false };
  }
});

/* UI ZOOM
   The renderer owns the zoom level (persisted with its preferences, stepped by
   Ctrl+= / Ctrl+- / Ctrl+0) and asks this process to apply it, because native
   webContents zoom scales everything — scrollbars included — where CSS zoom
   can't. Clamped again here so a corrupt preference can't wedge the window at
   an unreadable scale. */
ipcMain.handle("zoom:set", (evt, factor) => {
  const f = Number(factor);
  const clamped = Number.isFinite(f) ? Math.min(2, Math.max(0.5, f)) : 1;
  evt.sender.setZoomFactor(clamped);
  return clamped;
});

/* ============================================================================
   FILE EXPORT — native "Save As"
   Web builds fall back to an <a download> that drops files silently into the
   Downloads folder. In the desktop app the user picks the destination through
   the OS dialog instead, and can save a real PDF the browser build can't make.
============================================================================ */
function focusedWindow() {
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
}

// Reasonable dialog filters inferred from the file's extension.
function filtersForName(name) {
  const ext = (path.extname(name || "").replace(".", "") || "").toLowerCase();
  const known = {
    csv: "CSV Spreadsheet",
    xlsx: "Excel Workbook",
    json: "JSON File",
    doc: "Word Document",
    pdf: "PDF Document",
  };
  const filters = [];
  if (known[ext]) filters.push({ name: known[ext], extensions: [ext] });
  filters.push({ name: "All Files", extensions: ["*"] });
  return filters;
}

async function promptSavePath(defaultName) {
  const win = focusedWindow();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters: filtersForName(defaultName),
  });
  return canceled || !filePath ? null : filePath;
}

// Text payloads (CSV, JSON, Word HTML): write UTF-8 verbatim.
ipcMain.handle("export:saveText", async (_evt, { defaultName, content }) => {
  try {
    const filePath = await promptSavePath(defaultName);
    if (!filePath) return { ok: false, canceled: true };
    await fsp.writeFile(filePath, content, "utf-8");
    return { ok: true, path: filePath };
  } catch (err) {
    console.error("export:saveText failed", err);
    return { ok: false, error: err?.message || String(err) };
  }
});

// Binary payloads (xlsx workbook) arrive base64-encoded from the renderer.
ipcMain.handle("export:saveBinary", async (_evt, { defaultName, base64 }) => {
  try {
    const filePath = await promptSavePath(defaultName);
    if (!filePath) return { ok: false, canceled: true };
    await fsp.writeFile(filePath, Buffer.from(base64, "base64"));
    return { ok: true, path: filePath };
  } catch (err) {
    console.error("export:saveBinary failed", err);
    return { ok: false, error: err?.message || String(err) };
  }
});

/* Render an HTML report to a real PDF. An offscreen window loads the report
   from a temp file (data: URLs choke on the base64 screenshots a report can
   carry), prints to PDF, and the bytes are written to the chosen path. The temp
   file and offscreen window are always torn down, even on failure. */
ipcMain.handle("export:savePDF", async (_evt, { defaultName, html }) => {
  let tmpFile = null;
  let printWin = null;
  try {
    const filePath = await promptSavePath(defaultName);
    if (!filePath) return { ok: false, canceled: true };

    tmpFile = path.join(app.getPath("temp"), `btj-report-${Date.now()}.html`);
    await fsp.writeFile(tmpFile, html, "utf-8");

    printWin = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, sandbox: true },
    });
    await printWin.loadFile(tmpFile);
    const pdf = await printWin.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: "default" },
      pageSize: "A4",
    });
    await fsp.writeFile(filePath, pdf);
    return { ok: true, path: filePath };
  } catch (err) {
    console.error("export:savePDF failed", err);
    return { ok: false, error: err?.message || String(err) };
  } finally {
    if (printWin && !printWin.isDestroyed()) printWin.destroy();
    if (tmpFile) fsp.rm(tmpFile, { force: true }).catch(() => {});
  }
});

/* ============================================================================
   WINDOW STATE
   Size, position and maximized state persist across launches. The bounds are
   validated against the displays present at startup, so a window saved on a
   monitor that is no longer attached is pulled back onto a visible screen
   instead of opening off in the void.
============================================================================ */
const WINDOW_STATE_FILE = path.join(app.getPath("userData"), "window-state.json");
const DEFAULT_WINDOW = { width: 1440, height: 900 };
/* Floor, not a comfort target. The renderer's CSS is responsive well below
   desktop widths (the sidebar becomes a drawer under 860px and the tables
   scroll inside their own containers), so the OS window is allowed to shrink
   to roughly phone-panel size instead of being pinned at 1080x720 — that pin
   read as "the window refuses to resize". Still capped by effectiveMinimums()
   to whatever the current display can actually offer. */
const MIN_WIDTH = 480;
const MIN_HEIGHT = 520;

function readWindowState() {
  try {
    const raw = fs.readFileSync(WINDOW_STATE_FILE, "utf-8");
    const s = JSON.parse(raw);
    if (s && typeof s.width === "number" && typeof s.height === "number") return s;
  } catch { /* first run, or unreadable — fall back to defaults */ }
  return null;
}

// Keep at least a strip of the window's title bar on some visible display, so a
// disconnected or rearranged monitor can never hide it entirely.
function isVisibleOnSomeDisplay(bounds) {
  const displays = screen.getAllDisplays();
  return displays.some((d) => {
    const wa = d.workArea;
    const overlapX = Math.max(0, Math.min(bounds.x + bounds.width, wa.x + wa.width) - Math.max(bounds.x, wa.x));
    const overlapY = Math.max(0, Math.min(bounds.y + bounds.height, wa.y + wa.height) - Math.max(bounds.y, wa.y));
    return overlapX > 80 && overlapY > 40;
  });
}

/* The preferred minimums are a design floor, not a promise the hardware can
   keep: on a small or heavily-scaled display the work area can be shorter than
   MIN_HEIGHT. Enforcing 720px of minimum height inside a 672px work area makes
   the window taller than the screen and makes Windows refuse to maximize it at
   all (a maximize would have to violate the minimum). Measured on a 1280x720
   display with a 48px taskbar: maximize silently did nothing. So the minimums
   are capped to what the screen actually offers. */
function effectiveMinimums() {
  const wa = screen.getPrimaryDisplay().workAreaSize;
  return {
    minWidth: Math.min(MIN_WIDTH, wa.width),
    minHeight: Math.min(MIN_HEIGHT, wa.height),
  };
}

function computeInitialBounds() {
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const { minWidth, minHeight } = effectiveMinimums();
  // Never open larger than the work area, and never below the (capped) minimum.
  const fit = (value, min, max) => Math.max(min, Math.min(Math.round(value), max));

  const state = readWindowState();
  if (!state) {
    return {
      width: fit(DEFAULT_WINDOW.width, minWidth, wa.width),
      height: fit(DEFAULT_WINDOW.height, minHeight, wa.height),
      maximized: false,
    };
  }
  const width = fit(state.width, minWidth, wa.width);
  const height = fit(state.height, minHeight, wa.height);
  const out = { width, height, maximized: !!state.maximized };
  if (typeof state.x === "number" && typeof state.y === "number") {
    const candidate = { x: Math.round(state.x), y: Math.round(state.y), width, height };
    if (isVisibleOnSomeDisplay(candidate)) { out.x = candidate.x; out.y = candidate.y; }
  }
  return out;
}

let saveStateTimer = null;
// `sync` is used on window close: the app is quitting, and an async write there
// races the process exit and silently loses the final size. Everywhere else the
// write is debounced and async so dragging a window never blocks the main thread.
function persistWindowState(win, { sync = false } = {}) {
  if (win.isDestroyed()) return;
  const maximized = win.isMaximized();
  // getNormalBounds() reports the pre-maximize size, so restoring later gives
  // back the window the user actually sized rather than a full-screen rectangle.
  const bounds = win.getNormalBounds();
  const payload = JSON.stringify({ ...bounds, maximized });
  try {
    if (sync) fs.writeFileSync(WINDOW_STATE_FILE, payload, "utf-8");
    else fs.writeFile(WINDOW_STATE_FILE, payload, "utf-8", (err) => { if (err) console.error("window-state save failed", err); });
  } catch (err) {
    console.error("window-state save failed", err);
  }
}
function scheduleStateSave(win) {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(() => persistWindowState(win), 400);
}

function createWindow() {
  const initial = computeInitialBounds();
  const { minWidth, minHeight } = effectiveMinimums();
  const win = new BrowserWindow({
    width: initial.width,
    height: initial.height,
    x: initial.x,
    y: initial.y,
    minWidth,
    minHeight,
    backgroundColor: "#0A0E14",
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload only touches contextBridge + ipcRenderer.invoke, both of
      // which the sandboxed preload environment provides — it must stay that
      // way: requiring any other Node module there breaks under sandbox.
      sandbox: true,
    },
  });

  // maximize() must come after show(). On a window still hidden by show:false,
  // Windows applies the maximized *geometry* but never enters the real zoomed
  // state — isMaximized() then reports false, and the resize handler below
  // promptly writes maximized:false back, destroying the saved preference on
  // the first run. Showing first makes the maximize stick.
  //
  // show() alone can leave the window created-but-not-foreground: Windows'
  // foreground-lock timeout can deny a background process's own initial focus
  // steal, especially right after a previous instance was killed rather than
  // closed normally (the usual foreground-inheritance chain is broken). The
  // window then exists — visible, enabled, correctly sized — with nothing on
  // screen pointing at it, which reads to the user as "the app never opened".
  // focus() + app.focus({ steal: true }) forces it, matching what a real
  // user-initiated double-click would get automatically.
  win.once("ready-to-show", () => {
    win.show();
    if (initial.maximized) win.maximize();
    win.focus();
    app.focus({ steal: true });
  });

  win.on("resize", () => scheduleStateSave(win));
  win.on("move", () => scheduleStateSave(win));
  win.on("close", () => { clearTimeout(saveStateTimer); persistWindowState(win, { sync: true }); });

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

if (gotLock) {
  // Backup after the window is up, not before — it copies files, and the
  // window appearing promptly matters more than the snapshot's timing.
  app.whenReady().then(() => { createWindow(); autoBackupStorage(); });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
