import type { Role } from "@/shared/roles";

/**
 * Partition of everything stored offline. One partition per signed-in account
 * and its authorized scope (driver: vehicleId, loader: depotId). Rows of one
 * partition are never read, sent or purged on behalf of another.
 */
export type OfflineScope = { userId: string; role: Role; scopeId: string };

export function scopeKey(scope: OfflineScope): string {
  return `${scope.role}:${scope.userId}:${scope.scopeId}`;
}

/** TEAM_CONTRACT section 8 status set. */
export type EventStatus = "pending" | "sending" | "acknowledged" | "conflict" | "blocked";

/** Statuses that still hold unsynchronized work. */
export const UNSETTLED: readonly EventStatus[] = ["pending", "sending", "conflict", "blocked"];

export type EventError = {
  /** HTTP status, or null for network failure / timeout. */
  status: number | null;
  code: string;
  message: string;
  details?: unknown;
  at: string;
};

/** Where an uploaded evidence file's attachment id goes in the request body. */
export type FileRef = { clientFileId: string; field: string };

/**
 * Pending event envelope (TEAM_CONTRACT section 8) plus transport bookkeeping.
 * `payload` is the normalized body built at enqueue time. File references are
 * resolved and the body frozen into `sentBody` before the first send; retries
 * reuse `sentBody` and the same Idempotency-Key (= eventId) byte for byte.
 */
export type PendingEvent<P = Record<string, unknown>> = {
  eventId: string;
  scopeKey: string;
  seq: number;
  userId: string;
  role: Role;
  entityType: string;
  entityId: string;
  endpoint: string;
  method: "POST" | "PUT" | "PATCH";
  payload: P;
  /** Version the action was built on (the projected local version for chained actions). */
  baseVersion: number | null;
  planRevision: number | null;
  dependsOnEventIds: string[];
  clientAt: string;
  status: EventStatus;
  retryCount: number;
  lastError?: EventError;

  /** Short human label, e.g. "Arrived at stop 2". */
  label: string;
  /** Machine kind used by projections, e.g. "stop.arrive". */
  kind: string;
  /** Free-form context for projections and the sync screen (tripId, stopId...). */
  meta: Record<string, unknown>;
  fileRefs: FileRef[];
  createdAt: string;
  sentBody?: string;
  firstSentAt?: string;
  nextAttemptAt?: number;
  ackAt?: string;
  /** Server `data` from the acknowledging response. */
  result?: unknown;
};

export type EnqueueInput<P = Record<string, unknown>> = {
  entityType: string;
  entityId: string;
  endpoint: string;
  method?: PendingEvent["method"];
  payload: P;
  baseVersion?: number | null;
  planRevision?: number | null;
  dependsOnEventIds?: string[];
  clientAt?: string;
  label: string;
  kind: string;
  meta?: Record<string, unknown>;
  fileRefs?: FileRef[];
};

export type StoredSnapshot<T = unknown> = {
  scopeKey: string;
  key: string;
  data: T;
  savedAt: string;
};

export type StoredFile = {
  scopeKey: string;
  clientFileId: string;
  blob: Blob;
  contentType: string;
  size: number;
  createdAt: string;
  attachmentId?: string;
  uploadedAt?: string;
  /** Linked by an acknowledged business write; the blob may be dropped. */
  linked?: boolean;
};

export type PauseReason = "auth" | "account";

export type SyncMeta = {
  scopeKey: string;
  paused: PauseReason | null;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastNetworkError?: string;
};

export type AccountRecord = {
  scopeKey: string;
  scope: OfflineScope;
  displayName: string;
  lastActiveAt: string;
};

export type SyncState = {
  pending: number;
  sending: number;
  conflict: number;
  blocked: number;
  acknowledged: number;
  unsentFiles: number;
  paused: PauseReason | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastNetworkError: string | null;
  syncing: boolean;
};
