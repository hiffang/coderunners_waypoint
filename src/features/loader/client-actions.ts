"use client";

// Loader writes. Start, checks and issues go through the shared outbox, so they
// behave the same online and offline: persist locally first, then send.
// Release and issue resolution are online-only and never queued.
import { enqueueAction, newId, refreshOfflineShells, saveSnapshot, type OfflineScope, type ShellStatus } from "@/lib/offline";
import { apiFetch, ApiClientError } from "@/shared/api";
import type { ChecksPayload, IssuePayload, ProjectedManifest } from "./projection";
import type { LoaderIssueListDto, LoaderManifestDto, LoaderMutationResult, LoaderTripListDto } from "./types";

export const tripsKey = "trips";
export const issuesKey = "issues";
export const manifestKey = (id: string) => `manifest:${id}`;
export const revokedKey = (id: string) => `revoked:${id}`;

function tripLabel(m: Pick<ProjectedManifest, "vehicleId" | "tripNumber">) {
  return `${m.vehicleId} trip ${m.tripNumber}`;
}

/** Every loader event bumps Trip.version once, so each new event chains on all unsettled ones of the trip. */
function chain(m: ProjectedManifest) {
  return {
    baseVersion: m.projectedVersion,
    planRevision: m.planRevision,
    dependsOnEventIds: m.localEvents.map((e) => e.eventId),
  };
}

export function queueStart(scope: OfflineScope, m: ProjectedManifest) {
  const c = chain(m);
  return enqueueAction(scope, {
    entityType: "Trip",
    entityId: m.id,
    endpoint: `/api/loader/trips/${m.id}/start`,
    payload: { expectedVersion: c.baseVersion, planRevision: c.planRevision },
    ...c,
    label: `Started loading · ${tripLabel(m)}`,
    kind: "loader.start",
    meta: { tripId: m.id },
  });
}

export function queueChecks(scope: OfflineScope, m: ProjectedManifest, checks: ChecksPayload["checks"]) {
  const c = chain(m);
  const payload: ChecksPayload = { expectedVersion: c.baseVersion, planRevision: c.planRevision, checks };
  return enqueueAction(scope, {
    entityType: "Trip",
    entityId: m.id,
    endpoint: `/api/loader/trips/${m.id}/checks`,
    method: "PUT",
    payload,
    ...c,
    label: `${checks.length} line check${checks.length === 1 ? "" : "s"} · ${tripLabel(m)}`,
    kind: "loader.checks",
    meta: { tripId: m.id, lines: checks.length },
  });
}

export function queueIssue(scope: OfflineScope, m: ProjectedManifest, form: Omit<IssuePayload, "expectedVersion" | "planRevision">) {
  const c = chain(m);
  const payload: IssuePayload = { ...form, expectedVersion: c.baseVersion, planRevision: c.planRevision };
  return enqueueAction(scope, {
    entityType: "Trip",
    entityId: m.id,
    endpoint: `/api/loader/trips/${m.id}/issues`,
    payload,
    ...c,
    label: `${form.type === "SHORTFALL" ? "Shortfall" : form.type === "DAMAGE" ? "Damage" : "Issue"} report · ${tripLabel(m)}`,
    kind: "loader.issue",
    meta: { tripId: m.id },
  });
}

/** Release is online-only: the server validates checks, issues, revision and state. */
export function releaseOnline(m: { id: string; version: number; planRevision: number }, idempotencyKey: string) {
  return apiFetch<LoaderMutationResult>(`/api/loader/trips/${m.id}/ready`, {
    method: "POST",
    idempotencyKey,
    body: JSON.stringify({ expectedVersion: m.version, planRevision: m.planRevision }),
  });
}

export function resolveIssueOnline(
  m: { id: string; version: number; planRevision: number },
  issue: { id: string; version: number },
  resolution: string,
  idempotencyKey: string,
) {
  return apiFetch<LoaderMutationResult>(`/api/loader/trips/${m.id}/issues/${issue.id}/resolve`, {
    method: "POST",
    idempotencyKey,
    body: JSON.stringify({ expectedVersion: m.version, planRevision: m.planRevision, issueVersion: issue.version, resolution }),
  });
}

export async function fetchTripList(scope: OfflineScope) {
  const list = await apiFetch<LoaderTripListDto>("/api/loader/trips");
  await saveSnapshot(scope, tripsKey, list);
  return list;
}

export async function fetchIssues(scope: OfflineScope) {
  const list = await apiFetch<LoaderIssueListDto>("/api/loader/issues");
  await saveSnapshot(scope, issuesKey, list);
  return list;
}

/** Fetch and store one manifest. A 403/404 means it is no longer visible to this depot: remember that, keep the old copy. */
export async function fetchManifest(scope: OfflineScope, id: string) {
  try {
    const m = await apiFetch<LoaderManifestDto>(`/api/loader/trips/${id}`);
    await saveSnapshot(scope, manifestKey(id), m);
    return m;
  } catch (err) {
    if (err instanceof ApiClientError && (err.status === 403 || err.status === 404)) {
      await saveSnapshot(scope, revokedKey(id), { at: new Date().toISOString(), message: err.message });
    }
    throw err;
  }
}

export type DownloadResult = { trips: number; shell: ShellStatus; persisted: boolean };

/** "Download for offline": every manifest not yet departed, plus the app shell and its chunks. */
export async function downloadForOffline(scope: OfflineScope): Promise<DownloadResult> {
  const list = await fetchTripList(scope);
  const wanted = list.items.filter((t) => t.state === "PLANNED" || t.state === "LOADING" || t.state === "READY");
  await Promise.all(wanted.map((t) => fetchManifest(scope, t.id)));
  const [shell, persisted] = await Promise.all([
    refreshOfflineShells(),
    navigator.storage?.persist ? navigator.storage.persist().catch(() => false) : Promise.resolve(false),
  ]);
  return { trips: wanted.length, shell, persisted };
}

export { newId };
