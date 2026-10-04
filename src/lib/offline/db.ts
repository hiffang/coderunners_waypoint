import Dexie, { type EntityTable, type Table } from "dexie";
import type { AccountRecord, PendingEvent, StoredFile, StoredSnapshot, SyncMeta } from "./types";

/**
 * One IndexedDB database for every portal. Every row carries `scopeKey`
 * (role:userId:scopeId) and every query filters on it.
 * Bump the version and add an upgrade for schema changes; never drop tables
 * holding unsynchronized events or evidence in an upgrade.
 */
export class OfflineDb extends Dexie {
  snapshots!: Table<StoredSnapshot, [string, string]>;
  events!: EntityTable<PendingEvent, "eventId">;
  files!: Table<StoredFile, [string, string]>;
  syncMeta!: EntityTable<SyncMeta, "scopeKey">;
  accounts!: EntityTable<AccountRecord, "scopeKey">;

  constructor(name = "waypoint-offline") {
    super(name);
    this.version(1).stores({
      snapshots: "[scopeKey+key], scopeKey",
      events: "eventId, scopeKey, [scopeKey+seq], [scopeKey+status]",
      files: "[scopeKey+clientFileId], scopeKey",
      syncMeta: "scopeKey",
      accounts: "scopeKey, lastActiveAt",
    });
  }
}

let instance: OfflineDb | null = null;

export function offlineDb(): OfflineDb {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB unavailable");
  instance ??= new OfflineDb();
  return instance;
}
