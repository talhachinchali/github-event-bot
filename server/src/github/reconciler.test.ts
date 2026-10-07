import { describe, expect, it, vi } from "vitest";
import type { HookDelivery } from "./app-api.js";
import { reconcileDeliveries, selectRedeliveries } from "./reconciler.js";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
let nextId = 1;
const d = (over: Partial<HookDelivery> = {}): HookDelivery => ({
  id: nextId++, guid: `guid-${nextId}`, delivered_at: ago(5 * MIN), redelivery: false, status_code: 503, event: "issues", ...over,
});

describe("selectRedeliveries", () => {
  it("redelivers a failed delivery", () => {
    const f = d({ status_code: 503 });
    expect(selectRedeliveries([f], NOW)).toEqual([f]);
  });
  it.each([[0], [502], [404], [500]])("treats status %i as failed (0 = timeout / no response)", (code) => {
    expect(selectRedeliveries([d({ status_code: code })], NOW)).toHaveLength(1);
  });
  it.each([[200], [202]])("leaves successful deliveries alone (%i)", (code) => {
    expect(selectRedeliveries([d({ status_code: code })], NOW)).toHaveLength(0);
  });
  it("does not redeliver when a later attempt of the same guid already succeeded", () => {
    const failed = d({ guid: "g", status_code: 503, delivered_at: ago(10 * MIN) });
    const retried = d({ guid: "g", status_code: 200, delivered_at: ago(5 * MIN), redelivery: true });
    expect(selectRedeliveries([failed, retried], NOW)).toHaveLength(0);
  });
  it("redelivers a guid only once per run even if it failed several times", () => {
    const a = d({ guid: "g", delivered_at: ago(30 * MIN) });
    const b = d({ guid: "g", delivered_at: ago(10 * MIN), redelivery: true });
    expect(selectRedeliveries([a, b], NOW)).toEqual([b]);
  });
  it("waits for fresh failures to settle (< 1 min old)", () => {
    expect(selectRedeliveries([d({ delivered_at: ago(10_000) })], NOW)).toHaveLength(0);
  });
  it("ignores very old failures (> 24h)", () => {
    expect(selectRedeliveries([d({ delivered_at: ago(25 * 60 * MIN) })], NOW)).toHaveLength(0);
  });
  it("gives up on a delivery that has failed 6 times", () => {
    const many = Array.from({ length: 6 }, (_, i) => d({ guid: "poison", delivered_at: ago((10 + i) * MIN) }));
    expect(selectRedeliveries(many, NOW)).toHaveLength(0);
    expect(selectRedeliveries(many.slice(0, 5), NOW)).toHaveLength(1);
  });
  it("ignores events we do not handle (ping)", () => {
    expect(selectRedeliveries([d({ event: "ping" })], NOW)).toHaveLength(0);
  });
  it("handles installation events too", () => {
    expect(selectRedeliveries([d({ event: "installation" })], NOW)).toHaveLength(1);
  });
  it("caps work per run and goes oldest-first", () => {
    const many = Array.from({ length: 25 }, (_, i) => d({ delivered_at: ago((2 + i) * MIN) }));
    const picked = selectRedeliveries(many, NOW);
    expect(picked).toHaveLength(10);
    expect(picked[0]!.id).toBe(many[24]!.id); // the oldest failure first
  });
});

describe("reconcileDeliveries", () => {
  const deps = (list: () => Promise<HookDelivery[]>, redeliver = vi.fn().mockResolvedValue(undefined)) => ({ list, redeliver, now: () => NOW });

  it("asks GitHub to redeliver the failed ones", async () => {
    const f1 = d(), f2 = d(), ok = d({ status_code: 200 });
    const redeliver = vi.fn().mockResolvedValue(undefined);
    const r = await reconcileDeliveries(deps(async () => [f1, f2, ok], redeliver));
    expect(r).toEqual({ checked: 3, redelivered: 2, failed: 0 });
    expect(redeliver.mock.calls.map((c) => c[0]).sort()).toEqual([f1.id, f2.id].sort());
  });
  it("one failed redelivery request does not stop the others", async () => {
    const f1 = d({ delivered_at: ago(20 * MIN) }), f2 = d({ delivered_at: ago(10 * MIN) });
    const redeliver = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    const r = await reconcileDeliveries(deps(async () => [f1, f2], redeliver));
    expect(r).toEqual({ checked: 2, redelivered: 1, failed: 1 });
  });
  it("never throws when GitHub is unreachable", async () => {
    const r = await reconcileDeliveries(deps(async () => { throw new Error("GitHub down"); }));
    expect(r).toEqual({ checked: 0, redelivered: 0, failed: 1 });
  });
});
