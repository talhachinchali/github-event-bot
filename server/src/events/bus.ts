// In-process "something changed" signal used to push live updates to dashboards (Server-Sent Events).
// It carries NO data on purpose: every client re-fetches its own, ownership-scoped view, so nothing can leak
// between users through the bus. (Single instance, which is all the free tier runs.)
type Listener = () => void;
const listeners = new Set<Listener>();

export function onChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitChange(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* a broken listener must never affect the worker or webhook path */
    }
  }
}
