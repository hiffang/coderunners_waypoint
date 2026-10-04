// Pure outbox decisions, unit-tested without IndexedDB or a network.
import type { EventError, EventStatus, FileRef, PendingEvent } from "./types";

export const MAX_BACKOFF_MS = 5 * 60_000;
export const REQUEST_TIMEOUT_MS = 20_000;

/** Bounded exponential backoff with jitter for network failures and 5xx. */
export function backoffDelay(retryCount: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_BACKOFF_MS, 2_000 * 2 ** Math.max(0, retryCount - 1));
  return Math.round(base * (0.75 + random() * 0.5));
}

export type Outcome =
  | { kind: "ack" }
  | { kind: "retry"; error: EventError } // network, timeout, 5xx: keep pending, back off
  | { kind: "auth"; error: EventError } // 401: pause queue until the same user signs in again
  | { kind: "conflict"; error: EventError } // 409: needs explicit reconciliation
  | { kind: "blocked"; error: EventError }; // 400/403/404/422...: never retried automatically

/** Classify a business-write response. `status` null means the request never got an answer. */
export function classify(status: number | null, error?: { code?: string; message?: string; details?: unknown }, at = new Date()): Outcome {
  const e = (code: string, message: string): EventError => ({
    status,
    code: error?.code ?? code,
    message: error?.message ?? message,
    details: error?.details,
    at: at.toISOString(),
  });
  if (status === null) return { kind: "retry", error: e("NETWORK", "No connection to the server") };
  if (status >= 200 && status < 300) return { kind: "ack" };
  if (status === 401) return { kind: "auth", error: e("UNAUTHORIZED", "Session expired; sign in again") };
  // A plain CONFLICT that asks to retry is a lost serialization race, not a data conflict.
  if (status === 409 && error?.code === "CONFLICT" && /retry/i.test(error.message ?? "")) {
    return { kind: "retry", error: e("CONFLICT", "Busy server, retrying") };
  }
  if (status === 409) return { kind: "conflict", error: e("CONFLICT", "Server state changed") };
  if (status === 408 || status === 429 || status >= 500) return { kind: "retry", error: e("UNAVAILABLE", `Server error ${status}`) };
  return { kind: "blocked", error: e("REJECTED", `Rejected by server (${status})`) };
}

export type Readiness =
  | { kind: "ready" }
  | { kind: "wait" } // a dependency is still pending/sending, or backoff not elapsed
  | { kind: "blocked"; error: EventError } // a dependency needs attention
  | { kind: "chain-conflict"; error: EventError };

/**
 * May `event` be sent now? Dependencies must be acknowledged. If a dependency
 * on the same entity was acknowledged, its returned version must equal the
 * version this event was built on: the event then extends that acknowledged
 * local chain. Anything else is an unrelated server change -> visible conflict.
 */
export function readiness(
  event: Pick<PendingEvent, "entityType" | "entityId" | "baseVersion" | "dependsOnEventIds" | "nextAttemptAt" | "sentBody">,
  deps: Array<Pick<PendingEvent, "eventId" | "entityType" | "entityId" | "status" | "label" | "result" | "seq"> | undefined>,
  opts: { now: number; manual: boolean },
): Readiness {
  const at = new Date(opts.now).toISOString();
  for (const d of deps) {
    if (!d) {
      return { kind: "blocked", error: { status: null, code: "DEPENDENCY", message: "An earlier action it depends on was discarded", at } };
    }
    if (d.status === "conflict" || d.status === "blocked") {
      return { kind: "blocked", error: { status: null, code: "DEPENDENCY", message: `Waiting on "${d.label}", which needs attention`, at } };
    }
    if (d.status !== "acknowledged") return { kind: "wait" };
  }
  if (!opts.manual && event.nextAttemptAt && event.nextAttemptAt > opts.now) return { kind: "wait" };

  // Body already frozen: never re-derive it.
  if (event.sentBody === undefined && event.baseVersion !== null) {
    const sameEntity = deps
      .filter((d): d is NonNullable<typeof d> => !!d && d.entityType === event.entityType && d.entityId === event.entityId)
      .sort((a, b) => b.seq - a.seq)[0];
    const acked = sameEntity ? ackVersion(sameEntity.result) : null;
    if (sameEntity && acked !== null && acked !== event.baseVersion) {
      return {
        kind: "chain-conflict",
        error: {
          status: 409,
          code: "VERSION_CONFLICT",
          message: `Server is at version ${acked} after "${sameEntity.label}", this action was built on ${event.baseVersion}`,
          details: { expectedVersion: event.baseVersion, currentVersion: acked },
          at,
        },
      };
    }
  }
  return { kind: "ready" };
}

export function ackVersion(result: unknown): number | null {
  const v = (result as { version?: unknown } | null | undefined)?.version;
  return typeof v === "number" ? v : null;
}

/** Replace clientFileIds with server attachment ids. Throws if any upload is missing. */
export function resolveBody(payload: Record<string, unknown>, fileRefs: FileRef[], attachmentIds: Map<string, string>) {
  const body: Record<string, unknown> = { ...payload };
  const byField = new Map<string, string[]>();
  for (const ref of fileRefs) {
    const id = attachmentIds.get(ref.clientFileId);
    if (!id) throw new Error(`File ${ref.clientFileId} is not uploaded yet`);
    byField.set(ref.field, [...(byField.get(ref.field) ?? []), id]);
  }
  for (const [field, ids] of byField) body[field] = ids;
  return body;
}

export function statusAfter(outcome: Outcome): EventStatus {
  switch (outcome.kind) {
    case "ack":
      return "acknowledged";
    case "conflict":
      return "conflict";
    case "blocked":
      return "blocked";
    default:
      return "pending";
  }
}

/** Events that (transitively) depend on `eventId`, in queue order. */
export function dependentsOf<T extends Pick<PendingEvent, "eventId" | "dependsOnEventIds" | "seq">>(eventId: string, events: T[]): T[] {
  const out = new Map<string, T>();
  const frontier = [eventId];
  while (frontier.length) {
    const id = frontier.pop()!;
    for (const e of events) {
      if (!out.has(e.eventId) && e.dependsOnEventIds.includes(id)) {
        out.set(e.eventId, e);
        frontier.push(e.eventId);
      }
    }
  }
  return [...out.values()].sort((a, b) => a.seq - b.seq);
}
