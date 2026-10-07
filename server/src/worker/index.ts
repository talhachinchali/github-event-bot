import { logger } from "../logger.js";
import { listActiveRules } from "../rules/service.js";
import { MAX_ATTEMPTS, backoffSeconds } from "./backoff.js";
import { dryRunExecutors } from "./executors.js";
import { processEvent, type ProcessDeps } from "./process.js";
import * as queue from "./queue.js";
import { onWake } from "./signal.js";
import type { EventRow, Executors } from "./types.js";

const DB_RETRY_MS = 10_000;
const MAX_SLEEP_MS = 2 ** 31 - 1; // setTimeout limit

export interface Worker {
  start(): void;
  /** Stops claiming new work and waits for the in-flight event to finish. */
  stop(): Promise<void>;
  wake(): void;
}

export function createWorker(executors: Executors = dryRunExecutors): Worker {
  const deps: ProcessDeps = {
    loadRules: listActiveRules,
    executors,
    hasSucceeded: queue.hasSucceeded,
    recordAction: queue.recordAction,
  };

  let stopped = false;
  let wakeUp: (() => void) | null = null;
  // Sticky: a wake() that lands while we are busy (not sleeping) must not be lost.
  let wakeRequested = false;
  let loopDone: Promise<void> = Promise.resolve();

  // Sleep until woken (new webhook), the timeout elapses (scheduled retry), or stop().
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      if (wakeRequested) return resolve(); // something arrived since we last looked: go around again
      const timer = setTimeout(done, Math.min(ms, MAX_SLEEP_MS));
      function done() {
        clearTimeout(timer);
        wakeUp = null;
        resolve();
      }
      wakeUp = done;
    });

  async function handle(ev: EventRow) {
    const log = logger.child({ eventId: ev.id, repoId: ev.repoId, attempt: ev.attempts });
    try {
      // A poison event that keeps crashing the process (stale-lock reclaims) must not loop forever.
      if (ev.attempts > MAX_ATTEMPTS) {
        await queue.markDead(ev.id, "exceeded max attempts (worker crashed or timed out repeatedly)");
        log.error("event dead: too many attempts");
        return;
      }
      const outcome = await processEvent(ev, deps);
      if (outcome.status === "done") {
        await queue.markDone(ev.id);
        log.info("event processed");
      } else if (outcome.status === "retry") {
        const delay = backoffSeconds(ev.attempts);
        await queue.markRetry(ev.id, outcome.error, delay);
        log.warn({ error: outcome.error, retryInSeconds: delay }, "event failed, will retry");
      } else {
        await queue.markDead(ev.id, outcome.error);
        log.error({ error: outcome.error }, "event dead");
      }
    } catch (err) {
      // Unexpected failure (bug, DB blip while recording). Try to schedule a retry; if even that fails the
      // row stays 'processing' and is reclaimed by the stale-lock check, so it is never lost.
      log.error({ err: (err as Error).message }, "unexpected error while processing event");
      await (ev.attempts >= MAX_ATTEMPTS
        ? queue.markDead(ev.id, (err as Error).message)
        : queue.markRetry(ev.id, (err as Error).message, backoffSeconds(ev.attempts))
      ).catch(() => undefined);
    }
  }

  async function loop() {
    while (!stopped) {
      wakeRequested = false; // anything arriving after this point sets it again and skips the next sleep
      let ev: EventRow | null;
      try {
        ev = await queue.claimNext();
      } catch (err) {
        logger.warn({ err: (err as Error).message }, "worker cannot reach the database, retrying shortly");
        await sleep(DB_RETRY_MS);
        continue;
      }
      if (ev) {
        await handle(ev);
        continue;
      }
      // Idle. No polling: sleep until a webhook wakes us or the next scheduled retry is due.
      const next = await queue.nextWakeTime().catch(() => null);
      await sleep(next ? Math.max(1000, next.getTime() - Date.now()) : MAX_SLEEP_MS);
    }
  }

  const worker: Worker = {
    start() {
      stopped = false;
      onWake(() => worker.wake());
      loopDone = loop();
      logger.info("worker started");
    },
    async stop() {
      stopped = true;
      wakeRequested = true;
      wakeUp?.();
      await loopDone;
    },
    wake() {
      wakeRequested = true;
      wakeUp?.();
    },
  };
  return worker;
}
