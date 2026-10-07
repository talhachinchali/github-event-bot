export const MAX_ATTEMPTS = 5;
const BASE_SECONDS = 30;
const CAP_SECONDS = 3600;

/**
 * Delay before the next attempt, after `attempts` attempts have failed: 30s, 2m, 8m, 32m, (1h cap),
 * with +/-20% jitter so a burst of failures does not retry in lockstep. `random` is injectable for tests.
 */
export function backoffSeconds(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(BASE_SECONDS * 4 ** Math.max(0, attempts - 1), CAP_SECONDS);
  const jitter = 0.8 + random() * 0.4;
  return Math.round(base * jitter);
}
