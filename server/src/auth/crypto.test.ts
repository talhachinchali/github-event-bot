import { describe, expect, it } from "vitest";
import { decrypt, encrypt, randomToken, safeEqual, sha256 } from "./crypto.js";
import { authorizeUrl, pkceChallenge } from "./github-oauth.js";

const KEY = "ab".repeat(32);

describe("encrypt/decrypt (AES-256-GCM)", () => {
  it("round-trips and never stores plaintext", () => {
    const secret = "https://hooks.slack.com/services/T000/B000/XXXX";
    const enc = encrypt(secret, KEY);
    expect(enc).not.toContain("slack");
    expect(decrypt(enc, KEY)).toBe(secret);
  });
  it("uses a fresh IV each time", () => {
    expect(encrypt("same", KEY)).not.toBe(encrypt("same", KEY));
  });
  it("rejects tampered ciphertext", () => {
    const parts = encrypt("hello", KEY).split(".");
    parts[3] = Buffer.from("tampered!").toString("base64url");
    expect(() => decrypt(parts.join("."), KEY)).toThrow();
  });
  it("rejects the wrong key", () => {
    expect(() => decrypt(encrypt("hello", KEY), "cd".repeat(32))).toThrow();
  });
  it("rejects malformed input", () => {
    expect(() => decrypt("garbage", KEY)).toThrow();
  });
});

describe("helpers", () => {
  it("safeEqual compares correctly, including different lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
  it("randomToken is unique and url-safe", () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(randomToken());
  });
  it("sha256 is stable", () => {
    expect(sha256("a")).toBe("ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
  });
});

describe("PKCE / authorize url", () => {
  it("matches the RFC 7636 test vector", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
  it("includes state, S256 challenge and redirect uri", () => {
    const u = new URL(authorizeUrl("STATE123", "verifier"));
    expect(u.origin + u.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(u.searchParams.get("state")).toBe("STATE123");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("redirect_uri")).toMatch(/\/auth\/github\/callback$/);
    expect(u.searchParams.get("client_secret")).toBeNull();
  });
});
