// ============================================================================
// LOCAL AUTHENTICATION — a soft gate, not disk encryption.
// ----------------------------------------------------------------------------
// The journal's data still sits unencrypted on disk; this only keeps a casual
// second person at the same machine out of the *running app* once a user has
// opted in by creating an account. Passwords are never stored — only a
// PBKDF2-SHA-256 hash and its per-user random salt, so the stored record can't
// be read back into a password.
//
// Web Crypto (globalThis.crypto.subtle) is present in the browser, the Electron
// renderer and Node's test runtime alike, so this module stays pure and DOM-
// free and its logic is unit-tested in trade-adjacent test files.
//
// Multi-user ready and web-future ready: the store is a *list* of user records
// and nothing here assumes exactly one. A later internet-connected build can
// move this same {id, username, salt, hash} shape server-side and swap the
// local verify for a network call without the app shell changing — see
// ARCHITECTURE.md § Authentication.
// ============================================================================
import { uid } from "./trade";

const PBKDF2_ITERATIONS = 120000;
const HASH = "SHA-256";
const KEY_LEN_BITS = 256;

const subtle = () => {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("Web Crypto unavailable");
  return c.subtle;
};
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex) => new Uint8Array((String(hex).match(/.{1,2}/g) || []).map((h) => parseInt(h, 16)));
const randomHex = (bytes) => toHex(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));

// Trimmed for storage/compare; the display form keeps the user's own casing.
export function normalizeUsername(username) {
  return typeof username === "string" ? username.trim() : "";
}

// Derive { salt, hash } from a password. A fresh random salt each call unless
// one is supplied (verify re-derives against the stored salt).
export async function hashPassword(password, saltHex = randomHex(16)) {
  const enc = new TextEncoder();
  const keyMaterial = await subtle().importKey("raw", enc.encode(String(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle().deriveBits(
    { name: "PBKDF2", salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS, hash: HASH },
    keyMaterial, KEY_LEN_BITS
  );
  return { salt: saltHex, hash: toHex(bits) };
}

// Re-derive from the candidate against the stored salt and compare in constant
// time (equal-length hex). Good enough for a local gate.
export async function verifyPassword(password, saltHex, expectedHash) {
  if (!saltHex || !expectedHash) return false;
  const { hash } = await hashPassword(password, saltHex);
  if (hash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  return diff === 0;
}

// Coerce whatever is on file into a usable user list: every entry keeps an id,
// a non-blank username, and a salt+hash pair. A record missing its hash (a
// hand-edited store) is dropped rather than trusted as passwordless.
export function normalizeUsers(users) {
  return (Array.isArray(users) ? users : [])
    .filter((u) => u && typeof u === "object" && normalizeUsername(u.username) && typeof u.hash === "string" && typeof u.salt === "string")
    .map((u) => ({
      id: u.id || uid("USER"),
      username: normalizeUsername(u.username),
      salt: u.salt,
      hash: u.hash,
      createdAt: u.createdAt || "",
    }));
}

// Case-insensitive lookup — usernames are unique by lowercased form.
export function findUser(users, username) {
  const needle = normalizeUsername(username).toLowerCase();
  if (!needle) return null;
  return normalizeUsers(users).find((u) => u.username.toLowerCase() === needle) || null;
}

// Build a new user record, hashing the password. Throws on a blank username or
// password; the caller (the signup form) guards those first for a nicer message.
export async function makeUser(username, password) {
  const name = normalizeUsername(username);
  if (!name) throw new Error("Username required");
  if (!password) throw new Error("Password required");
  const { salt, hash } = await hashPassword(password);
  return { id: uid("USER"), username: name, salt, hash, createdAt: new Date().toISOString() };
}
