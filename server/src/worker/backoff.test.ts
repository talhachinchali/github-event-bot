import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, backoffSeconds } from "./backoff.js";

describe("backoffSeconds", () => {
  const mid = () => 0.5; // jitter factor exactly 1.0
  it("grows exponentially: 30s, 2m, 8m, 32m", () => {
    expect([1, 2, 3, 4].map((n) => backoffSeconds(n, mid))).toEqual([30, 120, 480, 1920]);
  });
  it("is capped at one hour", () => {
    expect(backoffSeconds(10, mid)).toBe(3600);
  });
  it("jitters by at most +/-20%", () => {
    expect(backoffSeconds(1, () => 0)).toBe(24);
    expect(backoffSeconds(1, () => 0.999)).toBeLessThanOrEqual(36);
  });
  it("allows a bounded number of attempts", () => {
    expect(MAX_ATTEMPTS).toBe(5);
  });
});
