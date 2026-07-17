const { contextBridge, ipcRenderer } = require("electron");

// Exposed as window.electronStorage — src/lib/storage.js auto-detects this
// and uses it instead of the browser IndexedDB fallback whenever the app
// is running inside Electron.
contextBridge.exposeInMainWorld("electronStorage", {
  get: (key) => ipcRenderer.invoke("storage:get", key),
  set: (key, value) => ipcRenderer.invoke("storage:set", key, value),
  delete: (key) => ipcRenderer.invoke("storage:delete", key),
  list: (prefix) => ipcRenderer.invoke("storage:list", prefix),
});

// Exposed as window.desktopExport — the renderer routes report/backup exports
// through the OS "Save As" dialog when present, and falls back to a browser
// download when it isn't (the plain web build). isElectron lets the UI decide
// which path to offer (e.g. a real PDF button only appears on desktop).
contextBridge.exposeInMainWorld("desktopExport", {
  isElectron: true,
  saveText: (defaultName, content) => ipcRenderer.invoke("export:saveText", { defaultName, content }),
  saveBinary: (defaultName, base64) => ipcRenderer.invoke("export:saveBinary", { defaultName, base64 }),
  savePDF: (defaultName, html) => ipcRenderer.invoke("export:savePDF", { defaultName, html }),
});

// Exposed as window.desktopZoom — the renderer applies its persisted UI zoom
// through Electron's native zoom when present, and falls back to CSS zoom on
// the web build when it isn't.
contextBridge.exposeInMainWorld("desktopZoom", {
  set: (factor) => ipcRenderer.invoke("zoom:set", factor),
});
