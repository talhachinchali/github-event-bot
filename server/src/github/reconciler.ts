import { logger } from "../logger.js";
import { listRecentDeliveries, redeliver, type HookDelivery } from "./app-api.js";

/**
 * GitHub does NOT retry failed webhook deliveries by itself. If we were down, restarting after a deploy, or
 * a free-tier host was asleep (cold start > GitHub's 10s timeout), that event would be lost forever.
 * The reconciler asks GitHub which recent deliveries failed and asks it to send them again. This is safe
 * because every delivery is deduplicated by its GUID (events.delivery_id is UNIQUE).
 */

const MIN_AGE_MS = 60_000; // let in-flight / just-failed deliveries settle
const MAX_AGE_MS = 24 * 3600_000; // GitHub only allows redelivery for a few days anyway
const MAX_ATTEMPTS_PER_GUID = 6; // stop hammering an event that never succeeds
const MAX_REDELIVERIES_PER_RUN = 10;
const HANDLED_EVENTS = new Set(["issues", "pull_request", "push", "installation", "installation_repositories"]);

export const isSuccess = (d: HookDelivery) => d.status_code >= 200 && d.status_code < 300;

/** Pure decision logic: which failed deliveries should be redelivered now? */
export function selectRedeliveries(deliveries: HookDelivery[], now: number): HookDelivery[] {
  const byGuid = new Map<string, HookDelivery[]>();
  for (const d of deliveries) byGuid.set(d.guid, [...(byGuid.get(d.guid) ?? []), d]);

  const picked: HookDelivery[] = [];
  for (const group of byGuid.values()) {
    if (group.some(isSuccess)) continue; // some attempt already succeeded
    const latest = group.reduce((a, b) => (Date.parse(b.delivered_at) > Date.parse(a.delivered_at) ? b : a));
    if (!HANDLED_EVENTS.has(latest.event)) continue; // e.g. ping
    const age = now - Date.parse(latest.delivered_at);
    if (age < MIN_AGE_MS || age > MAX_AGE_MS) continue;
    if (group.length >= MAX_ATTEMPTS_PER_GUID) continue;
    picked.push(latest);
  }
  return picked
    .sort((a, b) => Date.parse(a.delivered_at) - Date.parse(b.delivered_at)) // oldest first
    .slice(0, MAX_REDELIVERIES_PER_RUN);
}

export interface ReconcileDeps {
  list: () => Promise<HookDelivery[]>;
  redeliver: (id: number) => Promise<void>;
  now: () => number;
}

export interface ReconcileResult { checked: number; redelivered: number; failed: number }

/** Never throws: it runs on a timer, and a GitHub outage must not crash the process. */
export async function reconcileDeliveries(
  deps: ReconcileDeps = { list: listRecentDeliveries, redeliver, now: Date.now },
): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, redelivered: 0, failed: 0 };
  try {
    const deliveries = await deps.list();
    result.checked = deliveries.length;
    for (const d of selectRedeliveries(deliveries, deps.now())) {
      try {
        await deps.redeliver(d.id);
        result.redelivered++;
        logger.info({ deliveryId: d.guid, event: d.event, lastStatus: d.status_code }, "requested webhook redelivery");
      } catch (err) {
        result.failed++;
        logger.warn({ deliveryId: d.guid, err: (err as Error).message }, "webhook redelivery request failed");
      }
    }
  } catch (err) {
    result.failed++;
    logger.warn({ err: (err as Error).message }, "webhook reconciliation skipped");
  }
  return result;
}

let running = false;

/** Runs once shortly after boot (catches events missed while we were down/asleep), then periodically. */
export function startReconciler(opts: { firstRunMs?: number; intervalMs?: number } = {}) {
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r = await reconcileDeliveries();
      if (r.redelivered > 0) logger.info(r, "webhook reconciliation done");
    } finally {
      running = false;
    }
  };
  setTimeout(() => void run(), opts.firstRunMs ?? 20_000).unref();
  setInterval(() => void run(), opts.intervalMs ?? 10 * 60_000).unref();
}
