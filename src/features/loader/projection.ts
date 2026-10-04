// Pure optimistic view: server manifest (confirmed) + this account's queued
// loader events (local). The two are kept separate so the UI can label them.
import type { EventStatus, PendingEvent } from "@/lib/offline/types";
import type { TripState } from "@/shared/dto/enums";
import type { LoaderIssueInput } from "@/shared/dto/issue";
import type { LoadingChecksInput, ManifestLineDto, ManifestOrderDto, ManifestStopDto } from "@/shared/dto/manifest";
import { lineStatus, loadingReadiness } from "./readiness";
import type { LoaderManifestDto, LoadingReadiness } from "./types";

export const LOADER_KINDS = ["loader.start", "loader.checks", "loader.issue"] as const;
export type LoaderKind = (typeof LOADER_KINDS)[number];

export type ChecksPayload = LoadingChecksInput;
export type IssuePayload = LoaderIssueInput;

export type LocalCheck = { loadedUnits: number; damageUnits: number; note: string | null; eventId: string; status: EventStatus };
export type LineState = ReturnType<typeof lineStatus>;

export type ProjectedLine = ManifestLineDto & {
  /** Queued, not yet confirmed check (overrides the server check on screen). */
  local: LocalCheck | null;
  /** Status of what is on screen: the local check if any, else the server check. */
  status: LineState;
};
export type ProjectedOrder = Omit<ManifestOrderDto, "lines"> & { lines: ProjectedLine[] };
export type ProjectedStop = Omit<ManifestStopDto, "orders"> & { orders: ProjectedOrder[] };
export type LocalIssue = IssuePayload & { eventId: string; status: EventStatus; clientAt: string };

export type ProjectedManifest = Omit<LoaderManifestDto, "stops"> & {
  stops: ProjectedStop[];
  /** Server-confirmed state from the snapshot. */
  confirmedState: TripState;
  /** Trip.version to build the next queued action on (snapshot version + local events). */
  projectedVersion: number;
  /** Queued, not yet acknowledged loader events for this trip, in order. */
  localEvents: PendingEvent[];
  localIssues: LocalIssue[];
  /** Readiness of what is on screen, including queued checks. Only the server decides release. */
  localReadiness: LoadingReadiness;
  /** Some queued work needs a person: conflict or rejected. */
  attention: boolean;
  /** Queued work was recorded against a different plan revision than the manifest on screen. */
  revisionMismatch: boolean;
};

/** Events that still shape the view: unsettled, or acknowledged after the snapshot was saved. */
export function relevantEvents(events: PendingEvent[], tripId: string, snapshotSavedAt: string) {
  return events
    .filter((e) => e.meta.tripId === tripId && (LOADER_KINDS as readonly string[]).includes(e.kind))
    .filter((e) => e.status !== "acknowledged" || (e.ackAt ?? "") > snapshotSavedAt)
    .sort((a, b) => a.seq - b.seq);
}

export function projectManifest(snapshot: LoaderManifestDto, savedAt: string, events: PendingEvent[]): ProjectedManifest {
  const relevant = relevantEvents(events, snapshot.id, savedAt);
  let state: TripState = snapshot.state;
  let version = snapshot.version;
  const localChecks = new Map<string, LocalCheck & { planRevision: number; at: string }>();
  const localIssues: LocalIssue[] = [];

  for (const e of relevant) {
    const ackV = e.status === "acknowledged" ? (e.result as { version?: number } | undefined)?.version : undefined;
    version = typeof ackV === "number" ? ackV : version + 1;
    if (e.kind === "loader.start" && state === "PLANNED") state = "LOADING";
    if (e.kind === "loader.checks") {
      const p = e.payload as unknown as ChecksPayload;
      for (const c of p.checks) {
        localChecks.set(c.orderLineId, {
          loadedUnits: c.loadedUnits,
          damageUnits: c.damageUnits,
          note: c.note ?? null,
          eventId: e.eventId,
          status: e.status,
          planRevision: p.planRevision,
          at: e.clientAt,
        });
      }
      if (state === "READY") state = "LOADING";
    }
    if (e.kind === "loader.issue" && e.status !== "acknowledged") {
      localIssues.push({ ...(e.payload as unknown as IssuePayload), eventId: e.eventId, status: e.status, clientAt: e.clientAt });
    }
  }

  // A queued check replaces the server check on screen and in the local readiness estimate.
  const shownLine = (l: ManifestLineDto): ManifestLineDto => {
    const lc = localChecks.get(l.orderLineId);
    if (!lc) return l;
    return {
      ...l,
      check: {
        orderLineId: l.orderLineId,
        expectedUnits: l.expectedUnits,
        loadedUnits: lc.loadedUnits,
        damageUnits: lc.damageUnits,
        note: lc.note,
        planRevision: lc.planRevision,
        checkedAt: lc.at,
        checkedBy: l.check?.checkedBy ?? { id: "", name: "this device" },
      },
    };
  };
  const shownStops = snapshot.stops.map((s) => ({
    ...s,
    orders: s.orders.map((o) => ({ ...o, lines: o.lines.map(shownLine) })),
  }));
  const stops: ProjectedStop[] = snapshot.stops.map((s) => ({
    ...s,
    orders: s.orders.map((o) => ({
      ...o,
      lines: o.lines.map((l) => {
        const lc = localChecks.get(l.orderLineId);
        return {
          ...l,
          local: lc && lc.status !== "acknowledged" ? lc : null,
          status: lineStatus(shownLine(l), snapshot.planRevision),
        };
      }),
    })),
  }));

  const unsettled = relevant.filter((e) => e.status !== "acknowledged");
  const localReadiness = loadingReadiness({
    state,
    planRevision: snapshot.planRevision,
    refrigerated: snapshot.refrigerated,
    stops: shownStops,
    issues: [
      ...snapshot.issues,
      ...localIssues.map((i) => ({ blocking: i.type !== "OTHER", status: "OPEN" as const })),
    ],
  });

  return {
    ...snapshot,
    stops,
    state,
    confirmedState: snapshot.state,
    projectedVersion: version,
    localEvents: unsettled,
    localIssues,
    localReadiness,
    attention: unsettled.some((e) => e.status === "conflict" || e.status === "blocked"),
    revisionMismatch: unsettled.some((e) => e.planRevision !== null && e.planRevision !== snapshot.planRevision),
  };
}

/** Lines in physical loading order: last delivery first (reverse stop sequence). */
export function loadingOrder<S extends { loadingSequence: number }>(stops: S[]): S[] {
  return [...stops].sort((a, b) => a.loadingSequence - b.loadingSequence);
}

/** Every line of the trip with its stop and order, for lookups. */
export function allLines(m: { stops: ProjectedStop[] }) {
  return m.stops.flatMap((s) => s.orders.flatMap((o) => o.lines.map((l) => ({ line: l, order: o, stop: s }))));
}
