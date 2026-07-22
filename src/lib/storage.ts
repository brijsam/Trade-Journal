/**
 * Local key-value storage for Brij Trade Journal.
 *
 * Same shape everywhere — get/set/delete/list, each returning a promise —
 * so App.jsx never has to know or care which backend is active:
 *
 *  - Running inside Electron: window.electronStorage exists (exposed by
 *    electron/preload.cjs) and every call is routed to real files on disk
 *    under the OS's per-app data folder. This is what makes trade data and
 *    screenshots survive as genuine local files, no browser sandbox limits.
 *
 *  - Running as a plain web app (`npm run dev` without Electron): falls
 *    back to IndexedDB, which comfortably holds hundreds of MB — plenty
 *    for a screenshot-heavy trade journal, without needing a backend.
 */

// App.jsx calls every method with a vestigial trailing boolean at many call
// sites (a leftover from before this shared shape existed); harmless and
// ignored, kept accepted here rather than touched — a typing pass doesn't
// also clean up call sites.
export interface Storage {
  get(key: string, ...rest: unknown[]): Promise<StorageEntry | null>;
  set(key: string, value: string, ...rest: unknown[]): Promise<StorageEntry | null>;
  delete(key: string, ...rest: unknown[]): Promise<{ key: string; deleted: boolean; shared: boolean } | null>;
  list(prefix?: string, ...rest: unknown[]): Promise<{ keys: string[]; prefix?: string; shared: boolean }>;
}

const hasElectron = typeof window !== "undefined" && !!window.electronStorage;

const DB_NAME = "brij-trade-journal";
const STORE_NAME = "kv";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbGet(key: string): Promise<StorageEntry | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => {
      const row = req.result;
      resolve(row ? { key, value: row.value, shared: false } : null);
    };
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key: string, value: string): Promise<StorageEntry> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ key, value });
    tx.oncomplete = () => resolve({ key, value, shared: false });
    tx.onerror = () => reject(tx.error);
  });
}
async function idbDelete(key: string): Promise<{ key: string; deleted: boolean; shared: boolean }> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve({ key, deleted: true, shared: false });
    tx.onerror = () => reject(tx.error);
  });
}
async function idbList(prefix = ""): Promise<{ keys: string[]; prefix: string; shared: boolean }> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAllKeys();
    req.onsuccess = () => {
      const keys = req.result.filter((k) => !prefix || String(k).startsWith(prefix)).map(String);
      resolve({ keys, prefix, shared: false });
    };
    req.onerror = () => reject(req.error);
  });
}

export const storage: Storage = hasElectron
  ? {
      get: (key) => window.electronStorage!.get(key),
      set: (key, value) => window.electronStorage!.set(key, value),
      delete: (key) => window.electronStorage!.delete(key),
      list: (prefix) => window.electronStorage!.list(prefix),
    }
  : { get: idbGet, set: idbSet, delete: idbDelete, list: idbList };
