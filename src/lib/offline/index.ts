// Shared offline transport (Member 3). Client-only: import from client components.
// Usage guide: src/lib/offline/README.md.

export { scopeKey, UNSETTLED } from "./types";
export type {
  AccountRecord,
  EnqueueInput,
  EventError,
  EventStatus,
  FileRef,
  OfflineScope,
  PauseReason,
  PendingEvent,
  StoredSnapshot,
  SyncState,
} from "./types";

export {
  saveSnapshot,
  getSnapshot,
  deleteSnapshot,
  enqueueAction,
  unsettledEvents,
  listEvents,
  saveEvidenceBlob,
  getEvidenceBlob,
  deleteEvidenceBlob,
  getSyncState,
  retryEvent,
  discardEvent,
  rebaseEvent,
  purgeScope,
  rememberAccount,
  getActiveAccount,
  otherAccountsWithWork,
  newId,
} from "./store";

export { syncPending, isSyncing, type SyncResult } from "./sync";
export { subscribe, type OfflineSignal } from "./emitter";
export { OfflineStorageError, UnsyncedWorkError } from "./errors";
export { prepareEvidencePhoto } from "./photo";
export { useOfflineSnapshot, useOutbox, useSyncState, useAutoSync, useNavigatorOnline } from "./hooks";
export { ServiceWorkerRegistration, refreshOfflineShells, hasOfflineShell, swEnabled, type ShellStatus } from "./service-worker";
