import { offlineDb } from "./db";
import { emit } from "./emitter";
import { REQUEST_TIMEOUT_MS, backoffDelay, classify, readiness, resolveBody, statusAfter, type Outcome } from "./engine";
import { listEvents } from "./store";
import { scopeKey, type EventError, type OfflineScope, type PauseReason, type PendingEvent, type SyncMeta } from "./types";
import { IDEMPOTENCY_HEADER } from "@/shared/api";

export type SyncResult = { acknowledged: number; failed: number; paused: PauseReason | null; offline: boolean };

type Reply = { status: number | null; data?: unknown; error?: { code?: string; message?: string; details?: unknown } };

/** Single network primitive: a timeout or a dropped connection is `status: null` (ambiguous; never assume failure). */
async function request(url: string, init: RequestInit): Promise<Reply> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store", credentials: "same-origin" });
    const body = (await res.json().catch(() => null)) as
      | { ok: true; data: unknown }
      | { ok: false; error: { code: string; message: string; details?: unknown } }
      | null;
    if (body && body.ok === false) return { status: res.status, error: body.error };
    return { status: res.status, data: body && body.ok ? body.data : undefined };
  } catch {
    return { status: null };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- in-flight tracking (for UI)

const running = new Set<string>();
const runningListeners = new Set<() => void>();
export function isSyncing(scope: OfflineScope) {
  return running.has(scopeKey(scope));
}
export function onSyncingChange(fn: () => void) {
  runningListeners.add(fn);
  return () => runningListeners.delete(fn);
}
function setRunning(key: string, on: boolean) {
  if (on) running.add(key);
  else running.delete(key);
  runningListeners.forEach((l) => l());
}

const inflight = new Map<string, Promise<SyncResult>>();

/**
 * Send this account's pending events in queue order, through each role's
 * ordinary endpoint with the event id as Idempotency-Key. Safe to call often:
 * one run per scope at a time (also across tabs via Web Locks).
 *
 * - Verifies the session first. 401 pauses the queue; a different signed-in
 *   account pauses it too, so another user's work is never uploaded.
 * - Uploads evidence blobs first (idempotent per clientFileId), then freezes
 *   the request body. Retries resend the frozen body byte for byte.
 * - Network failure / timeout: event stays pending (the server may have
 *   committed; the idempotency key makes the resend safe) and the run stops.
 * - 409: conflict, kept with its evidence for explicit reconciliation.
 * - 4xx: blocked; never retried automatically. Dependants wait, unrelated events continue.
 */
export function syncPending(scope: OfflineScope, opts: { manual?: boolean } = {}): Promise<SyncResult> {
  const key = scopeKey(scope);
  const existing = inflight.get(key);
  if (existing) return existing;
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  const exec = async (): Promise<SyncResult> =>
    locks ? locks.request(`waypoint-sync:${key}`, () => runSync(scope, !!opts.manual)) : runSync(scope, !!opts.manual);
  const run = exec().finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

async function setMeta(key: string, patch: Partial<SyncMeta>) {
  const db = offlineDb();
  const current = (await db.syncMeta.get(key)) ?? { scopeKey: key, paused: null };
  await db.syncMeta.put({ ...current, ...patch, scopeKey: key });
}

async function runSync(scope: OfflineScope, manual: boolean): Promise<SyncResult> {
  const key = scopeKey(scope);
  const db = offlineDb();
  const result: SyncResult = { acknowledged: 0, failed: 0, paused: null, offline: false };
  setRunning(key, true);
  emit({ type: "sync-start", scopeKey: key });
  try {
    await setMeta(key, { lastAttemptAt: new Date().toISOString() });

    // 1. Who is signed in right now? Only that account's partition may be sent.
    const me = await request("/api/shared/me", { method: "GET" });
    if (me.status === null) {
      result.offline = true;
      await setMeta(key, { lastNetworkError: "No connection to the server" });
      return result;
    }
    if (me.status === 401) return pause(key, "auth", result);
    const meId = (me.data as { id?: string } | undefined)?.id;
    if (me.status === 200 && meId !== scope.userId) return pause(key, "account", result);
    if (me.status !== 200) {
      await setMeta(key, { lastNetworkError: `Server error ${me.status}` });
      return result;
    }
    await setMeta(key, { paused: null, lastNetworkError: undefined });

    // 2. Queue order. Re-read each row: earlier iterations change dependency state.
    const queue = (await listEvents(scope)).filter((e) => e.status === "pending" || e.status === "sending");
    for (const { eventId } of queue) {
      const e = await db.events.get(eventId);
      if (!e || (e.status !== "pending" && e.status !== "sending")) continue;
      const deps = await Promise.all(e.dependsOnEventIds.map((id) => db.events.get(id)));
      const r = readiness(e, deps, { now: Date.now(), manual });
      if (r.kind === "wait") continue;
      if (r.kind === "blocked" || r.kind === "chain-conflict") {
        await settle(e, r.kind === "blocked" ? { kind: "blocked", error: r.error } : { kind: "conflict", error: r.error });
        result.failed++;
        continue;
      }

      // 3. Freeze the body on first send: upload files, map ids. Never again afterwards.
      let body = e.sentBody;
      if (body === undefined) {
        const ids = new Map<string, string>();
        let stop: "offline" | "auth" | "event" | null = null;
        for (const ref of e.fileRefs) {
          const file = await db.files.get([key, ref.clientFileId]);
          if (!file) {
            await settle(e, { kind: "blocked", error: errorOf("FILE_MISSING", "Photo is no longer stored on this phone") });
            stop = "event";
            break;
          }
          if (!file.attachmentId) {
            const form = new FormData();
            form.set("clientFileId", ref.clientFileId);
            form.set("file", new File([file.blob], `${ref.clientFileId}.${ext(file.contentType)}`, { type: file.contentType }));
            const up = await request("/api/shared/files", { method: "POST", body: form });
            const outcome = classify(up.status, up.error);
            if (outcome.kind !== "ack") {
              await settle(e, outcome);
              stop = outcome.kind === "retry" && up.status === null ? "offline" : outcome.kind === "auth" ? "auth" : "event";
              break;
            }
            const attachmentId = (up.data as { id: string }).id;
            await db.files.update([key, ref.clientFileId], { attachmentId, uploadedAt: new Date().toISOString() });
            file.attachmentId = attachmentId;
          }
          ids.set(ref.clientFileId, file.attachmentId);
        }
        if (stop === "offline") {
          result.offline = true;
          break;
        }
        if (stop === "auth") return pause(key, "auth", result);
        if (stop === "event") {
          result.failed++;
          continue;
        }
        body = JSON.stringify(resolveBody(e.payload, e.fileRefs, ids));
        await db.events.update(e.eventId, { sentBody: body, firstSentAt: new Date().toISOString() });
      }

      // 4. Business write through the role's ordinary endpoint.
      await db.events.update(e.eventId, { status: "sending" });
      const res = await request(e.endpoint, {
        method: e.method,
        body,
        headers: { "content-type": "application/json", [IDEMPOTENCY_HEADER]: e.eventId },
      });
      const outcome = classify(res.status, res.error);
      await settle({ ...e, sentBody: body }, outcome, res.data);
      if (outcome.kind === "ack") {
        result.acknowledged++;
        continue;
      }
      result.failed++;
      if (outcome.kind === "auth") return pause(key, "auth", result);
      if (outcome.kind === "retry" && res.status === null) {
        result.offline = true;
        break;
      }
    }

    if (!result.offline) await setMeta(key, { lastSuccessAt: new Date().toISOString() });
    await pruneAcknowledged(key);
    return result;
  } finally {
    setRunning(key, false);
    emit({ type: "sync-end", scopeKey: key, acknowledged: result.acknowledged, failed: result.failed });
  }
}

async function pause(key: string, reason: PauseReason, result: SyncResult): Promise<SyncResult> {
  await setMeta(key, { paused: reason });
  emit({ type: "paused", scopeKey: key, reason });
  result.paused = reason;
  return result;
}

function errorOf(code: string, message: string): EventError {
  return { status: null, code, message, at: new Date().toISOString() };
}

function ext(type: string) {
  return type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
}

async function settle(e: PendingEvent, outcome: Outcome, data?: unknown) {
  const db = offlineDb();
  const status = statusAfter(outcome);
  if (outcome.kind === "ack") {
    const acked: Partial<PendingEvent> = { status, result: data, ackAt: new Date().toISOString(), lastError: undefined, nextAttemptAt: undefined };
    await db.transaction("rw", db.events, db.files, async () => {
      await db.events.update(e.eventId, acked);
      // Evidence now lives on the server; drop the local copy.
      for (const ref of e.fileRefs) await db.files.delete([e.scopeKey, ref.clientFileId]);
    });
    emit({ type: "acknowledged", scopeKey: e.scopeKey, event: { ...e, ...acked } as PendingEvent });
    return;
  }
  const retryCount = e.retryCount + 1;
  const patch: Partial<PendingEvent> = {
    status,
    lastError: outcome.error,
    retryCount,
    nextAttemptAt: outcome.kind === "retry" ? Date.now() + backoffDelay(retryCount) : undefined,
  };
  await db.events.update(e.eventId, patch);
  if (outcome.kind === "conflict") emit({ type: "conflict", scopeKey: e.scopeKey, event: { ...e, ...patch } as PendingEvent });
  if (outcome.kind === "blocked") emit({ type: "blocked", scopeKey: e.scopeKey, event: { ...e, ...patch } as PendingEvent });
}

const ACK_RETENTION_MS = 3 * 24 * 3600_000;
async function pruneAcknowledged(key: string) {
  const cutoff = new Date(Date.now() - ACK_RETENTION_MS).toISOString();
  await offlineDb()
    .events.where({ scopeKey: key })
    .filter((e) => e.status === "acknowledged" && (e.ackAt ?? "") < cutoff)
    .delete();
}
