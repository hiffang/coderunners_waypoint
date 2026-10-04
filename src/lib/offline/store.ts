import Dexie from "dexie";
import { offlineDb } from "./db";
import { emit } from "./emitter";
import { dependentsOf } from "./engine";
import { toStorageError, UnsyncedWorkError } from "./errors";
import {
  scopeKey,
  UNSETTLED,
  type AccountRecord,
  type EnqueueInput,
  type OfflineScope,
  type PendingEvent,
  type StoredFile,
  type SyncState,
} from "./types";

let lastSeq = 0;
function nextSeq() {
  lastSeq = Math.max(Date.now() * 1000, lastSeq + 1);
  return lastSeq;
}

export function newId(): string {
  return crypto.randomUUID();
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toStorageError(err);
  }
}

// ---------------------------------------------------------------- snapshots (server base)

export async function saveSnapshot<T>(scope: OfflineScope, key: string, data: T): Promise<void> {
  await guard(() => offlineDb().snapshots.put({ scopeKey: scopeKey(scope), key, data, savedAt: new Date().toISOString() }));
}

export async function getSnapshot<T>(scope: OfflineScope, key: string): Promise<{ data: T; savedAt: string } | null> {
  const row = await offlineDb().snapshots.get([scopeKey(scope), key]);
  return row ? { data: row.data as T, savedAt: row.savedAt } : null;
}

export async function deleteSnapshot(scope: OfflineScope, key: string): Promise<void> {
  await guard(() => offlineDb().snapshots.delete([scopeKey(scope), key]));
}

// ---------------------------------------------------------------- evidence blobs

/** Persist a photo before it is referenced. Throws OfflineStorageError (e.g. quota) and stores nothing on failure. */
export async function saveEvidenceBlob(scope: OfflineScope, clientFileId: string, blob: Blob): Promise<void> {
  const row: StoredFile = {
    scopeKey: scopeKey(scope),
    clientFileId,
    blob,
    contentType: blob.type || "application/octet-stream",
    size: blob.size,
    createdAt: new Date().toISOString(),
  };
  await guard(() => offlineDb().files.put(row));
}

export async function getEvidenceBlob(scope: OfflineScope, clientFileId: string): Promise<StoredFile | undefined> {
  return offlineDb().files.get([scopeKey(scope), clientFileId]);
}

/** Remove a photo that no queued event references (e.g. the driver removed it from the form). */
export async function deleteEvidenceBlob(scope: OfflineScope, clientFileId: string): Promise<void> {
  const key = scopeKey(scope);
  await guard(() =>
    offlineDb().transaction("rw", offlineDb().events, offlineDb().files, async () => {
      const users = await offlineDb()
        .events.where({ scopeKey: key })
        .filter((e) => e.fileRefs.some((f) => f.clientFileId === clientFileId) && e.status !== "acknowledged")
        .count();
      if (users > 0) throw new Error("Photo is part of a queued action");
      await offlineDb().files.delete([key, clientFileId]);
    }),
  );
}

// ---------------------------------------------------------------- outbox

/**
 * Queue one business action. The event row and any new evidence blobs are
 * written in a single IndexedDB transaction: either all persist or the call
 * throws OfflineStorageError and nothing was saved. Projections are derived
 * from the persisted event (see `kind`/`meta`/`payload`), so the optimistic
 * view and the queue can never disagree.
 */
export async function enqueueAction<P extends Record<string, unknown>>(
  scope: OfflineScope,
  input: EnqueueInput<P>,
  newFiles: Array<{ clientFileId: string; blob: Blob }> = [],
): Promise<PendingEvent<P>> {
  const key = scopeKey(scope);
  const event: PendingEvent<P> = {
    eventId: newId(),
    scopeKey: key,
    seq: nextSeq(),
    userId: scope.userId,
    role: scope.role,
    entityType: input.entityType,
    entityId: input.entityId,
    endpoint: input.endpoint,
    method: input.method ?? "POST",
    payload: input.payload,
    baseVersion: input.baseVersion ?? null,
    planRevision: input.planRevision ?? null,
    dependsOnEventIds: input.dependsOnEventIds ?? [],
    clientAt: input.clientAt ?? new Date().toISOString(),
    status: "pending",
    retryCount: 0,
    label: input.label,
    kind: input.kind,
    meta: input.meta ?? {},
    fileRefs: input.fileRefs ?? [],
    createdAt: new Date().toISOString(),
  };
  const db = offlineDb();
  await guard(() =>
    db.transaction("rw", db.events, db.files, async () => {
      for (const f of newFiles) {
        await db.files.put({
          scopeKey: key,
          clientFileId: f.clientFileId,
          blob: f.blob,
          contentType: f.blob.type || "application/octet-stream",
          size: f.blob.size,
          createdAt: event.createdAt,
        });
      }
      for (const ref of event.fileRefs) {
        if (!(await db.files.get([key, ref.clientFileId]))) throw new Error(`Photo ${ref.clientFileId} is not stored`);
      }
      for (const dep of event.dependsOnEventIds) {
        const d = await db.events.get(dep);
        if (!d || d.scopeKey !== key) throw new Error("Dependency is not in this account's queue");
      }
      await db.events.add(event as PendingEvent);
    }),
  );
  emit({ type: "enqueued", scopeKey: key, event: event as PendingEvent });
  return event;
}

export async function listEvents(scope: OfflineScope): Promise<PendingEvent[]> {
  return offlineDb()
    .events.where("[scopeKey+seq]")
    .between([scopeKey(scope), Dexie.minKey], [scopeKey(scope), Dexie.maxKey])
    .toArray();
}

/** Unsettled events matching `filter`; use their ids as `dependsOnEventIds`. */
export async function unsettledEvents(scope: OfflineScope, filter: (e: PendingEvent) => boolean = () => true) {
  return (await listEvents(scope)).filter((e) => UNSETTLED.includes(e.status) && filter(e));
}

/** Explicit retry of a conflict/blocked event (and the chain blocked behind it). The frozen body is reused. */
export async function retryEvent(scope: OfflineScope, eventId: string): Promise<void> {
  const db = offlineDb();
  await guard(() =>
    db.transaction("rw", db.events, async () => {
      const all = await db.events.where({ scopeKey: scopeKey(scope) }).toArray();
      const target = all.find((e) => e.eventId === eventId);
      if (!target || target.status === "acknowledged") return;
      for (const e of [target, ...dependentsOf(eventId, all)]) {
        if (e.status === "conflict" || e.status === "blocked") {
          await db.events.update(e.eventId, { status: "pending", nextAttemptAt: undefined });
        }
      }
    }),
  );
}

/**
 * Explicitly drop an unsynchronized event plus every event built on it.
 * Their evidence blobs are deleted too. Returns the discarded events.
 */
export async function discardEvent(scope: OfflineScope, eventId: string): Promise<PendingEvent[]> {
  const db = offlineDb();
  const key = scopeKey(scope);
  return guard(() =>
    db.transaction("rw", db.events, db.files, async () => {
      const all = await db.events.where({ scopeKey: key }).toArray();
      const target = all.find((e) => e.eventId === eventId);
      if (!target || target.status === "acknowledged") return [];
      const doomed = [target, ...dependentsOf(eventId, all).filter((e) => e.status !== "acknowledged")];
      await db.events.bulkDelete(doomed.map((e) => e.eventId));
      const keep = new Set(
        all.filter((e) => !doomed.includes(e) && e.status !== "acknowledged").flatMap((e) => e.fileRefs.map((f) => f.clientFileId)),
      );
      for (const f of doomed.flatMap((e) => e.fileRefs)) {
        if (!keep.has(f.clientFileId)) await db.files.delete([key, f.clientFileId]);
      }
      return doomed;
    }),
  );
}

/**
 * Explicit reconciliation after a 409: re-create the action against the
 * current server version under a NEW event id (a different request must never
 * reuse an idempotency key). Same evidence blobs, same dependants (re-pointed).
 * Callers must show the current server state and get the user's confirmation first.
 */
export async function rebaseEvent(
  scope: OfflineScope,
  eventId: string,
  patch: { baseVersion: number; planRevision?: number; payload?: Record<string, unknown> },
): Promise<PendingEvent | null> {
  const db = offlineDb();
  const key = scopeKey(scope);
  const created = await guard(() =>
    db.transaction("rw", db.events, async () => {
      const old = await db.events.get(eventId);
      if (!old || old.scopeKey !== key || old.status !== "conflict") return null;
      const next: PendingEvent = {
        ...old,
        eventId: newId(),
        seq: old.seq, // keep queue position
        payload: patch.payload ?? old.payload,
        baseVersion: patch.baseVersion,
        planRevision: patch.planRevision ?? old.planRevision,
        dependsOnEventIds: [],
        status: "pending",
        retryCount: 0,
        lastError: undefined,
        sentBody: undefined,
        firstSentAt: undefined,
        nextAttemptAt: undefined,
        meta: { ...old.meta, rebasedFrom: old.eventId },
      };
      await db.events.delete(old.eventId);
      await db.events.add(next);
      const dependants = await db.events.where({ scopeKey: key }).filter((e) => e.dependsOnEventIds.includes(old.eventId)).toArray();
      for (const d of dependants) {
        await db.events.update(d.eventId, {
          dependsOnEventIds: d.dependsOnEventIds.map((id) => (id === old.eventId ? next.eventId : id)),
          status: d.status === "blocked" ? "pending" : d.status,
        });
      }
      return next;
    }),
  );
  return created;
}

// ---------------------------------------------------------------- state, accounts, purge

export async function getSyncState(scope: OfflineScope, syncing = false): Promise<SyncState> {
  const key = scopeKey(scope);
  const db = offlineDb();
  const [events, files, meta] = await Promise.all([
    db.events.where({ scopeKey: key }).toArray(),
    db.files.where({ scopeKey: key }).toArray(),
    db.syncMeta.get(key),
  ]);
  const count = (s: PendingEvent["status"]) => events.filter((e) => e.status === s).length;
  return {
    pending: count("pending"),
    sending: count("sending"),
    conflict: count("conflict"),
    blocked: count("blocked"),
    acknowledged: count("acknowledged"),
    unsentFiles: files.filter((f) => !f.linked).length,
    paused: meta?.paused ?? null,
    lastAttemptAt: meta?.lastAttemptAt ?? null,
    lastSuccessAt: meta?.lastSuccessAt ?? null,
    lastNetworkError: meta?.lastNetworkError ?? null,
    syncing,
  };
}

/** Record which account this device last used (online, after a verified session). */
export async function rememberAccount(scope: OfflineScope, displayName: string): Promise<void> {
  const record: AccountRecord = { scopeKey: scopeKey(scope), scope, displayName, lastActiveAt: new Date().toISOString() };
  await guard(() => offlineDb().accounts.put(record));
}

/** Most recently verified account for `role`; used to open the offline shell without a server. */
export async function getActiveAccount(role: OfflineScope["role"]): Promise<AccountRecord | null> {
  const rows = await offlineDb().accounts.orderBy("lastActiveAt").reverse().toArray();
  return rows.find((r) => r.scope.role === role) ?? null;
}

/** Other partitions on this device that still hold unsynchronized work. */
export async function otherAccountsWithWork(scope: OfflineScope): Promise<Array<{ account: AccountRecord | null; scopeKey: string; unsettled: number }>> {
  const me = scopeKey(scope);
  const db = offlineDb();
  const events = await db.events.filter((e) => e.scopeKey !== me && UNSETTLED.includes(e.status)).toArray();
  const byKey = new Map<string, number>();
  for (const e of events) byKey.set(e.scopeKey, (byKey.get(e.scopeKey) ?? 0) + 1);
  return Promise.all(
    [...byKey].map(async ([k, unsettled]) => ({ scopeKey: k, unsettled, account: (await db.accounts.get(k)) ?? null })),
  );
}

/**
 * Remove every private row of this partition (snapshots, events, evidence,
 * account record). Refuses while unsynchronized work exists unless the user
 * explicitly chose to discard it.
 */
export async function purgeScope(scope: OfflineScope, opts: { discardUnsynced?: boolean } = {}): Promise<void> {
  const key = scopeKey(scope);
  const db = offlineDb();
  await db.transaction("rw", [db.snapshots, db.events, db.files, db.syncMeta, db.accounts], async () => {
    const unsettled = await db.events.where({ scopeKey: key }).filter((e) => UNSETTLED.includes(e.status)).count();
    if (unsettled > 0 && !opts.discardUnsynced) throw new UnsyncedWorkError(unsettled);
    await db.snapshots.where({ scopeKey: key }).delete();
    await db.events.where({ scopeKey: key }).delete();
    await db.files.where({ scopeKey: key }).delete();
    await db.syncMeta.delete(key);
    await db.accounts.delete(key);
  });
}
