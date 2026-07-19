/**
 * Tests for the local authentication gate — ./auth. Pure, DOM-free: the hashing
 * runs on Web Crypto (globalThis.crypto.subtle), which Node's test runtime
 * provides just like the browser and the Electron renderer do.
 */
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, normalizeUsers, findUser, makeUser, normalizeUsername } from "./auth";

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
