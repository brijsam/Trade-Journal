/// <reference types="vite/client" />

// Injected by vite.config.js's `define` from package.json's version at build
// time (see RELEASING.md) — never a real binding, hence the ambient
// declaration rather than an import. Also declared as an eslint global in
// eslint.config.js for the same reason.
declare const __APP_VERSION__: string;

// The three globals electron/preload.cjs exposes via contextBridge. Only
// present when running inside the Electron shell — App.jsx/lib/storage.js
// feature-detect them (`typeof window.electronStorage !== "undefined"`) and
// fall back to the web build's own path (IndexedDB, browser download,
// CSS zoom) when they're absent. See electron/main.cjs for the ipcMain
// handlers these resolve to.
interface StorageEntry { key: string; value: string; shared: boolean; }
interface ExportResult { ok: boolean; canceled?: boolean; path?: string; error?: string; }
interface Window {
  electronStorage?: {
    get(key: string): Promise<StorageEntry | null>;
    set(key: string, value: string): Promise<StorageEntry | null>;
    delete(key: string): Promise<{ key: string; deleted: boolean; shared: boolean } | null>;
    list(prefix?: string): Promise<{ keys: string[]; prefix?: string; shared: boolean }>;
  };
  desktopExport?: {
    isElectron: true;
    saveText(defaultName: string, content: string): Promise<ExportResult>;
    saveBinary(defaultName: string, base64: string): Promise<ExportResult>;
    savePDF(defaultName: string, html: string): Promise<ExportResult>;
  };
  desktopZoom?: {
    set(factor: number): Promise<number>;
  };
}
