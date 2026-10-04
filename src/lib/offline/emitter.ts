import type { PendingEvent } from "./types";

export type OfflineSignal =
  | { type: "enqueued"; scopeKey: string; event: PendingEvent }
  | { type: "sync-start"; scopeKey: string }
  | { type: "sync-end"; scopeKey: string; acknowledged: number; failed: number }
  | { type: "acknowledged"; scopeKey: string; event: PendingEvent }
  | { type: "conflict"; scopeKey: string; event: PendingEvent }
  | { type: "blocked"; scopeKey: string; event: PendingEvent }
  | { type: "paused"; scopeKey: string; reason: "auth" | "account" };

type Listener = (signal: OfflineSignal) => void;
const listeners = new Set<Listener>();

/** Subscribe to outbox signals in this tab. Returns an unsubscribe function. Data hooks use Dexie live queries instead. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit(signal: OfflineSignal) {
  for (const l of listeners) {
    try {
      l(signal);
    } catch (err) {
      console.error(err);
    }
  }
}
