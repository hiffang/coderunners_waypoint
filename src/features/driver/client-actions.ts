"use client";

// Driver writes. Everything except departure goes through the shared outbox,
// so it behaves the same online and offline: persist locally first, then send.
import {
  enqueueAction,
  newId,
  refreshOfflineShells,
  saveSnapshot,
  type OfflineScope,
  type ShellStatus,
} from "@/lib/offline";
import { apiFetch, ApiClientError } from "@/shared/api";
import type { DriverMutationResult, DriverTripListDto, DriverTripSnapshotDto } from "./types";
import {
  returnDependencies,
  stopDependencies,
  type IssuePayload,
  type OutcomePayload,
  type ProjectedStop,
  type ProjectedTrip,
} from "./projection";

export const tripsKey = "trips";
export const tripKey = (id: string) => `trip:${id}`;
export const revokedKey = (id: string) => `revoked:${id}`;

function stopLabel(stop: ProjectedStop) {
  return `stop ${stop.sequence} · ${stop.outletId}`;
}

export function queueArrive(scope: OfflineScope, trip: ProjectedTrip, stop: ProjectedStop) {
  const clientAt = new Date().toISOString();
  return enqueueAction(scope, {
    entityType: "Stop",
    entityId: stop.stopId,
    endpoint: `/api/driver/stops/${stop.stopId}/arrive`,
    payload: { expectedVersion: stop.projectedVersion, planRevision: trip.planRevision, clientAt },
    baseVersion: stop.projectedVersion,
    planRevision: trip.planRevision,
    dependsOnEventIds: stopDependencies(trip, stop.stopId, "stop.arrive"),
    clientAt,
    label: `Arrived at ${stopLabel(stop)}`,
    kind: "stop.arrive",
    meta: { tripId: trip.id, stopId: stop.stopId, sequence: stop.sequence },
  });
}

export function queueOutcome(
  scope: OfflineScope,
  trip: ProjectedTrip,
  stop: ProjectedStop,
  form: Pick<OutcomePayload, "outcome" | "recipientName" | "note" | "failureReason" | "lines">,
  photos: Array<{ clientFileId: string; blob: Blob }>,
) {
  const clientAt = new Date().toISOString();
  const payload: OutcomePayload = {
    expectedVersion: stop.projectedVersion,
    planRevision: trip.planRevision,
    outcome: form.outcome,
    ...(form.recipientName ? { recipientName: form.recipientName } : {}),
    ...(form.note ? { note: form.note } : {}),
    ...(form.failureReason ? { failureReason: form.failureReason } : {}),
    evidenceFileIds: [], // replaced by server attachment ids right before the first send
    lines: form.lines,
    clientAt,
  };
  return enqueueAction(
    scope,
    {
      entityType: "Stop",
      entityId: stop.stopId,
      endpoint: `/api/driver/stops/${stop.stopId}/outcome`,
      payload,
      baseVersion: stop.projectedVersion,
      planRevision: trip.planRevision,
      dependsOnEventIds: stopDependencies(trip, stop.stopId, "stop.outcome"),
      clientAt,
      label: `${form.outcome === "DELIVERED" ? "Delivered" : form.outcome === "PARTIAL" ? "Partly delivered" : "Failed"} at ${stopLabel(stop)}`,
      kind: "stop.outcome",
      meta: { tripId: trip.id, stopId: stop.stopId, sequence: stop.sequence, photos: photos.length },
      fileRefs: photos.map((p) => ({ clientFileId: p.clientFileId, field: "evidenceFileIds" })),
    },
    photos,
  );
}

export function queueIssue(
  scope: OfflineScope,
  trip: ProjectedTrip,
  stop: ProjectedStop,
  form: Pick<IssuePayload, "type" | "severity" | "text">,
) {
  const clientAt = new Date().toISOString();
  const payload: IssuePayload = { ...form, expectedVersion: stop.projectedVersion, planRevision: trip.planRevision, clientAt };
  return enqueueAction(scope, {
    entityType: "Stop",
    entityId: stop.stopId,
    endpoint: `/api/driver/stops/${stop.stopId}/issues`,
    payload,
    baseVersion: stop.projectedVersion,
    planRevision: trip.planRevision,
    dependsOnEventIds: stopDependencies(trip, stop.stopId, "stop.issue"),
    clientAt,
    label: `${form.type.charAt(0)}${form.type.slice(1).toLowerCase()} issue at ${stopLabel(stop)}`,
    kind: "stop.issue",
    meta: { tripId: trip.id, stopId: stop.stopId, sequence: stop.sequence },
  });
}

export function queueReturn(scope: OfflineScope, trip: ProjectedTrip) {
  const clientAt = new Date().toISOString();
  return enqueueAction(scope, {
    entityType: "Trip",
    entityId: trip.id,
    endpoint: `/api/driver/trips/${trip.id}/return`,
    payload: { expectedVersion: trip.version, planRevision: trip.planRevision, clientAt },
    baseVersion: trip.version,
    planRevision: trip.planRevision,
    dependsOnEventIds: returnDependencies(trip),
    clientAt,
    label: `Returned to depot · ${trip.vehicleId} trip ${trip.tripNumber}`,
    kind: "trip.return",
    meta: { tripId: trip.id },
  });
}

/** Departure is online-only: the server validates release, revision and vehicle. */
export async function departOnline(trip: { id: string; version: number; planRevision: number }, idempotencyKey: string) {
  return apiFetch<DriverMutationResult>(`/api/driver/trips/${trip.id}/depart`, {
    method: "POST",
    idempotencyKey,
    body: JSON.stringify({ expectedVersion: trip.version, planRevision: trip.planRevision, clientAt: new Date().toISOString() }),
  });
}

export async function fetchTripList(scope: OfflineScope) {
  const list = await apiFetch<DriverTripListDto>("/api/driver/trips");
  await saveSnapshot(scope, tripsKey, list);
  return list;
}

/** Fetch and store one trip. A 403/404 means the route is no longer this driver's: remember that, keep the old copy. */
export async function fetchTrip(scope: OfflineScope, id: string) {
  try {
    const snap = await apiFetch<DriverTripSnapshotDto>(`/api/driver/trips/${id}`);
    await saveSnapshot(scope, tripKey(id), snap);
    return snap;
  } catch (err) {
    if (err instanceof ApiClientError && (err.status === 403 || err.status === 404)) {
      await saveSnapshot(scope, revokedKey(id), { at: new Date().toISOString(), message: err.message });
    }
    throw err;
  }
}

export type DownloadResult = { trips: number; shell: ShellStatus; persisted: boolean };

/** "Download for offline": every unfinished trip snapshot, plus the app shell and its chunks. */
export async function downloadForOffline(scope: OfflineScope): Promise<DownloadResult> {
  const list = await fetchTripList(scope);
  const wanted = list.items.filter((t) => t.state !== "COMPLETED");
  await Promise.all(wanted.map((t) => fetchTrip(scope, t.id)));
  const [shell, persisted] = await Promise.all([
    refreshOfflineShells(),
    navigator.storage?.persist ? navigator.storage.persist().catch(() => false) : Promise.resolve(false),
  ]);
  return { trips: wanted.length, shell, persisted };
}

export { newId };
