/**
 * Tests for the local authentication gate — ./auth. Pure, DOM-free: the hashing
 * runs on Web Crypto (globalThis.crypto.subtle), which Node's test runtime
 * provides just like the browser and the Electron renderer do.
 */
import { describe, it, expect } from "vitest";
import {
  hashPassword, verifyPassword, normalizeUsers, findUser, makeUser, normalizeUsername,
  displayNameOf, updateProfile, changePassword, DISPLAY_NAME_MAX,
} from "./auth";

describe("password hashing", () => {
  it("never stores the password and verifies the right one against the stored salt", async () => {
    const { salt, hash } = await hashPassword("correct horse");
    expect(hash).not.toContain("correct");
    expect(salt).toMatch(/^[0-9a-f]+$/);
    expect(await verifyPassword("correct horse", salt, hash)).toBe(true);
    expect(await verifyPassword("wrong password", salt, hash)).toBe(false);
  });

  it("is deterministic for a fixed salt and salted per call otherwise", async () => {
    const a = await hashPassword("pw", "00112233445566778899aabbccddeeff");
    const b = await hashPassword("pw", "00112233445566778899aabbccddeeff");
    expect(a.hash).toBe(b.hash);
    const c = await hashPassword("pw");
    const d = await hashPassword("pw");
    expect(c.salt).not.toBe(d.salt); // fresh random salt each time
    expect(c.hash).not.toBe(d.hash);
  });

  it("rejects verification when salt or hash is missing", async () => {
    expect(await verifyPassword("pw", "", "abc")).toBe(false);
    expect(await verifyPassword("pw", "abc", "")).toBe(false);
  });
});

describe("user store", () => {
  it("makeUser builds a record with an id, timestamp and no plaintext", async () => {
    const u = await makeUser("  Brij  ", "s3cret");
    expect(u.username).toBe("Brij"); // trimmed, casing kept
    expect(u.id).toBeTruthy();
    expect(u.createdAt).toBeTruthy();
    expect(JSON.stringify(u)).not.toContain("s3cret");
    expect(await verifyPassword("s3cret", u.salt, u.hash)).toBe(true);
  });

  it("makeUser rejects a blank username or password", async () => {
    await expect(makeUser("", "pw")).rejects.toThrow(/username/i);
    await expect(makeUser("Brij", "")).rejects.toThrow(/password/i);
  });

  it("normalizeUsers drops records without a username or hash", () => {
    const clean = normalizeUsers([
      { username: "A", salt: "s", hash: "h" },
      { username: "  ", salt: "s", hash: "h" }, // blank username
      { username: "B", salt: "s" },             // no hash — not trusted as passwordless
      "junk",
    ]);
    expect(clean.map((u) => u.username)).toEqual(["A"]);
    expect(clean[0].id).toBeTruthy();
  });

  it("findUser matches case-insensitively and returns null for a miss", () => {
    const users = [{ username: "Brij", salt: "s", hash: "h" }];
    expect(findUser(users, "brij")?.username).toBe("Brij");
    expect(findUser(users, "BRIJ")?.username).toBe("Brij");
    expect(findUser(users, "someone")).toBeNull();
    expect(findUser(users, "")).toBeNull();
  });

  it("normalizeUsername trims and tolerates non-strings", () => {
    expect(normalizeUsername("  x ")).toBe("x");
    expect(normalizeUsername(null)).toBe("");
  });
});

/* The profile fields (v3.5) are additive: a store written before them has to
   load unchanged, and nothing here may become a second way to authenticate —
   sign-in still matches on username alone. */
describe("profile fields", () => {
  it("falls back to the username when no display name is set", () => {
    expect(displayNameOf({ username: "brij" })).toBe("brij");
    expect(displayNameOf({ username: "brij", displayName: "Brij K" })).toBe("Brij K");
    expect(displayNameOf({ username: "brij", displayName: "   " })).toBe("brij");
    expect(displayNameOf(null)).toBe("");
  });

  it("loads a record written before profiles existed, unchanged", () => {
    const [u] = normalizeUsers([{ id: "u1", username: "brij", salt: "s", hash: "h", createdAt: "2026-01-01" }]);
    expect(u).toMatchObject({ username: "brij", displayName: "", avatar: "", lastLoginAt: "" });
  });

  it("keeps only a usable avatar, so a junk value can't bloat the auth store", () => {
    const store = (avatar) => normalizeUsers([{ username: "a", salt: "s", hash: "h", avatar }])[0].avatar;
    expect(store("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
    expect(store("https://example.com/me.png")).toBe("");   // not an inline image
    expect(store(`data:image/png;base64,${"A".repeat(500000)}`)).toBe(""); // past the cap
    expect(store(42)).toBe("");
  });

  it("trims and caps a display name the same way on write and on read", () => {
    const long = "x".repeat(DISPLAY_NAME_MAX + 20);
    const user = { id: "u1", username: "brij", salt: "s", hash: "h", createdAt: "" };
    expect(updateProfile(user, { displayName: "  Brij  " }).displayName).toBe("Brij");
    expect(updateProfile(user, { displayName: long }).displayName).toHaveLength(DISPLAY_NAME_MAX);
    expect(normalizeUsers([{ ...user, displayName: long }])[0].displayName).toHaveLength(DISPLAY_NAME_MAX);
  });

  it("returns a new record rather than mutating the one in the store", () => {
    const user = { id: "u1", username: "brij", salt: "s", hash: "h", createdAt: "" };
    const next = updateProfile(user, { displayName: "Brij" });
    expect(next).not.toBe(user);
    expect(user.displayName).toBeUndefined();
  });

  it("leaves the fields it was not asked about alone", () => {
    const user = { id: "u1", username: "brij", salt: "s", hash: "h", createdAt: "", displayName: "Brij", avatar: "data:image/png;base64,AAA" };
    expect(updateProfile(user, { displayName: "B" }).avatar).toBe("data:image/png;base64,AAA");
    expect(updateProfile(user, { avatar: "" }).displayName).toBe("Brij");
  });
});

describe("changePassword", () => {
  const account = () => makeUser("brij", "hunter2");

  it("re-hashes against a fresh salt and accepts only the new password afterwards", async () => {
    const user = await account();
    const next = await changePassword(user, "hunter2", "new-secret");
    expect(next.salt).not.toBe(user.salt);
    expect(next.hash).not.toBe(user.hash);
    expect(await verifyPassword("new-secret", next.salt, next.hash)).toBe(true);
    expect(await verifyPassword("hunter2", next.salt, next.hash)).toBe(false);
  });

  // Someone at an unattended signed-in session must not be able to take the
  // account over without knowing the password that opened it.
  it("refuses without the current password", async () => {
    const user = await account();
    await expect(changePassword(user, "not-it", "new-secret")).rejects.toThrow(/current password/i);
    await expect(changePassword(user, "", "new-secret")).rejects.toThrow(/current password/i);
  });

  it("refuses a too-short or unchanged new password", async () => {
    const user = await account();
    await expect(changePassword(user, "hunter2", "abc")).rejects.toThrow(/at least 4/i);
    await expect(changePassword(user, "hunter2", "hunter2")).rejects.toThrow(/already your password/i);
  });

  it("keeps the identity and profile intact through the change", async () => {
    const user = { ...(await account()), displayName: "Brij K", avatar: "data:image/png;base64,AAA" };
    const next = await changePassword(user, "hunter2", "new-secret");
    expect(next).toMatchObject({ id: user.id, username: "brij", displayName: "Brij K", avatar: "data:image/png;base64,AAA", createdAt: user.createdAt });
  });
});
