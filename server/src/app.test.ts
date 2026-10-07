import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";
import type { AddressInfo } from "node:net";

describe("health", () => {
  it("GET /healthz returns ok", async () => {
    const server = createApp().listen(0);
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    server.close();
  });
});
