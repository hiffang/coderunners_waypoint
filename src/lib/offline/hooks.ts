"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { offlineDb } from "./db";
import { subscribe } from "./emitter";
import { getSyncState, listEvents } from "./store";
import { isSyncing, onSyncingChange, syncPending, type SyncResult } from "./sync";
import { scopeKey, type OfflineScope, type PendingEvent, type SyncState } from "./types";

/** Server base snapshot for `key`, live from IndexedDB. undefined = loading, null = never downloaded. */
export function useOfflineSnapshot<T>(scope: OfflineScope | null, key: string) {
  const sk = scope ? scopeKey(scope) : null;
  return useLiveQuery(
    async () => {
      if (!sk) return null;
      const row = await offlineDb().snapshots.get([sk, key]);
      return row ? { data: row.data as T, savedAt: row.savedAt } : null;
    },
    [sk, key],
  );
}

/** Every outbox event of this account in queue order, live. */
export function useOutbox(scope: OfflineScope | null): PendingEvent[] | undefined {
  const sk = scope ? scopeKey(scope) : null;
  return useLiveQuery(async () => (scope ? listEvents(scope) : []), [sk]);
}

function useSyncing(scope: OfflineScope | null) {
  return useSyncExternalStore(
    onSyncingChange,
    () => (scope ? isSyncing(scope) : false),
    () => false,
  );
}

export function useSyncState(scope: OfflineScope | null): SyncState | undefined {
  const sk = scope ? scopeKey(scope) : null;
  const syncing = useSyncing(scope);
  return useLiveQuery(async () => (scope ? getSyncState(scope, syncing) : undefined), [sk, syncing]);
}

/** Browser connectivity hint only; the outbox decides by actual request failure. */
export function useNavigatorOnline() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/**
 * Keep the outbox moving: sync on mount, on `online`, on app focus, right
 * after something is queued, and every 30 s while work is waiting (each event
 * still honours its own backoff). Background Sync is deliberately not required.
 */
export function useAutoSync(
  scope: OfflineScope | null,
  opts: { enabled?: boolean; onResult?: (r: SyncResult) => void } = {},
) {
  const enabled = opts.enabled ?? true;
  const onResult = useRef(opts.onResult);
  useEffect(() => {
    onResult.current = opts.onResult;
  });
  const sk = scope ? scopeKey(scope) : null;

  const run = useCallback(
    async (manual = false) => {
      if (!scope) return null;
      const r = await syncPending(scope, { manual });
      onResult.current?.(r);
      return r;
    },
    // scope identity is captured by its key
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sk],
  );

  useEffect(() => {
    if (!enabled || !sk) return;
    const kick = () => void run(false);
    const onVisible = () => document.visibilityState === "visible" && kick();
    kick();
    window.addEventListener("online", kick);
    window.addEventListener("focus", kick);
    document.addEventListener("visibilitychange", onVisible);
    const unsub = subscribe((s) => {
      if (s.type === "enqueued" && s.scopeKey === sk) kick();
    });
    const timer = window.setInterval(async () => {
      if (!scope) return;
      const st = await getSyncState(scope);
      if (st.pending + st.sending > 0 && !st.paused) kick();
    }, 30_000);
    return () => {
      window.removeEventListener("online", kick);
      window.removeEventListener("focus", kick);
      document.removeEventListener("visibilitychange", onVisible);
      unsub();
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sk, run]);

  const syncNow = useCallback(() => run(true), [run]);
  return { syncNow };
}
