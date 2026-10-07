import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySignature } from "./signature.js";

const SECRET = "s3cret";
const sign = (body: Buffer, secret = SECRET) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

describe("verifySignature", () => {
  const body = Buffer.from('{"msg":"héllo  wörld","n":1}'); // unicode + odd spacing: bytes matter
  it("accepts a correct signature", () => {
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  });
  it("rejects a signature made with another secret", () => {
    expect(verifySignature(body, sign(body, "other"), SECRET)).toBe(false);
  });
  it("rejects a tampered body", () => {
    expect(verifySignature(Buffer.from('{"msg":"changed"}'), sign(body), SECRET)).toBe(false);
  });
  it("rejects a re-serialized body (whitespace changes the bytes)", () => {
    const reserialized = Buffer.from(JSON.stringify(JSON.parse(body.toString())).replace(":", ": "));
    expect(verifySignature(reserialized, sign(body), SECRET)).toBe(false);
  });
  it.each([
    ["missing header", undefined],
    ["empty header", ""],
    ["wrong prefix", "sha1=" + "a".repeat(40)],
    ["no prefix", "a".repeat(64)],
    ["too short", "sha256=abcd"],
    ["too long", "sha256=" + "a".repeat(65)],
    ["non-hex", "sha256=" + "z".repeat(64)],
  ])("rejects %s without throwing", (_name, header) => {
    expect(verifySignature(body, header, SECRET)).toBe(false);
  });
});
