// Tiny in-process wake-up channel so the webhook route can nudge the worker without importing it.
let listener: (() => void) | null = null;

export const onWake = (fn: () => void) => {
  listener = fn;
};
export const wakeWorker = () => listener?.();
