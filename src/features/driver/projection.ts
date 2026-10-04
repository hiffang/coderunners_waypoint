// Pure optimistic view: server snapshot (confirmed) + this account's queued
// driver events (local). The two are kept separate so the UI can label them.
import type { PendingEvent } from "@/lib/offline/types";
import type { DeliveryOutcome, StopState, TripState } from "@/shared/dto/enums";
import type { ManifestStopDto } from "@/shared/dto/manifest";
import type { DriverTripSnapshotDto } from "./types";

export const DRIVER_KINDS = ["stop.arrive", "stop.outcome", "stop.issue", "trip.return"] as const;
export type DriverKind = (typeof DRIVER_KINDS)[number];

export type OutcomePayload = {
  expectedVersion: number;
  planRevision: number;
  outcome: DeliveryOutcome;
  recipientName?: string;
  note?: string;
  failureReason?: string;
  evidenceFileIds: string[];
  lines: Array<{ orderLineId: string; deliveredUnits: number; damagedUnits: number }>;
  clientAt: string;
};

export type IssuePayload = {
  expectedVersion: number;
  planRevision: number;
  type: "DELAY" | "ACCESS" | "DAMAGE" | "OTHER";
  severity: "LOW" | "MEDIUM" | "HIGH";
  text: string;
  clientAt: string;
};

export type ProjectedStop = ManifestStopDto & {
  /** Server-confirmed state from the snapshot. */
  confirmedState: StopState;
  /** Version to build the next action on (snapshot version + local events). */
  projectedVersion: number;
  /** Queued, not yet acknowledged actions for this stop. */
  localEvents: PendingEvent[];
  localArrivalAt: string | null;
  localOutcome: OutcomePayload | null;
  localIssues: IssuePayload[];
  attention: boolean;
};

export type ProjectedTrip = Omit<DriverTripSnapshotDto, "stops"> & {
  confirmedState: TripState;
  stops: ProjectedStop[];
  localReturnAt: string | null;
  localEvents: PendingEvent[];
  /** Index into stops of the stop to work on next, or -1. */
  currentStopIndex: number;
};

const TERMINAL: readonly StopState[] = ["DELIVERED", "PARTIAL", "FAILED"];

export function isTerminal(state: StopState) {
  return TERMINAL.includes(state);
}

/** Events that still shape the view: unsettled, or acknowledged after the snapshot was saved. */
export function relevantEvents(events: PendingEvent[], tripId: string, snapshotSavedAt: string) {
  return events
    .filter((e) => e.meta.tripId === tripId && (DRIVER_KINDS as readonly string[]).includes(e.kind))
    .filter((e) => e.status !== "acknowledged" || (e.ackAt ?? "") > snapshotSavedAt)
    .sort((a, b) => a.seq - b.seq);
}

export function projectTrip(snapshot: DriverTripSnapshotDto, savedAt: string, events: PendingEvent[]): ProjectedTrip {
  const relevant = relevantEvents(events, snapshot.id, savedAt);
  let tripState: TripState = snapshot.state;
  let localReturnAt: string | null = null;

  const stops: ProjectedStop[] = snapshot.stops.map((s) => {
    const mine = relevant.filter((e) => e.entityType === "Stop" && e.entityId === s.stopId);
    let state = s.state;
    let version = s.version;
    let localArrivalAt: string | null = null;
    let localOutcome: OutcomePayload | null = null;
    const localIssues: IssuePayload[] = [];
    for (const e of mine) {
      const ackV = e.status === "acknowledged" ? (e.result as { version?: number } | undefined)?.version : undefined;
      version = typeof ackV === "number" ? ackV : version + 1;
      if (e.kind === "stop.arrive" && state === "PENDING") {
        state = "ARRIVED";
        localArrivalAt = e.clientAt;
      } else if (e.kind === "stop.outcome") {
        localOutcome = e.payload as unknown as OutcomePayload;
        state = localOutcome.outcome;
      } else if (e.kind === "stop.issue") {
        localIssues.push(e.payload as unknown as IssuePayload);
      }
    }
    const unsettled = mine.filter((e) => e.status !== "acknowledged");
    return {
      ...s,
      confirmedState: s.state,
      state,
      projectedVersion: version,
      localEvents: unsettled,
      localArrivalAt,
      localOutcome,
      localIssues,
      attention: unsettled.some((e) => e.status === "conflict" || e.status === "blocked"),
    };
  });

  const tripEvents = relevant.filter((e) => e.entityType === "Trip" && e.entityId === snapshot.id);
  for (const e of tripEvents) {
    if (e.kind === "trip.return") {
      tripState = "COMPLETED";
      localReturnAt = e.clientAt;
    }
  }

  const currentStopIndex =
    tripState === "IN_TRANSIT" ? stops.findIndex((s) => !isTerminal(s.state)) : -1;

  return {
    ...snapshot,
    confirmedState: snapshot.state,
    state: tripState,
    stops,
    localReturnAt,
    localEvents: relevant.filter((e) => e.status !== "acknowledged"),
    currentStopIndex,
  };
}

/**
 * dependsOnEventIds for a new stop action: earlier unsettled events on the same
 * stop, plus (for arrival) unsettled events on earlier stops, because the
 * server only accepts arrival once earlier stops are terminal.
 */
export function stopDependencies(trip: ProjectedTrip, stopId: string, kind: DriverKind): string[] {
  const idx = trip.stops.findIndex((s) => s.stopId === stopId);
  const ids = new Set(trip.stops[idx]?.localEvents.map((e) => e.eventId) ?? []);
  if (kind === "stop.arrive") {
    for (const s of trip.stops.slice(0, Math.max(0, idx))) s.localEvents.forEach((e) => ids.add(e.eventId));
  }
  return [...ids];
}

/** Return depends on every unsettled event of the trip. */
export function returnDependencies(trip: ProjectedTrip): string[] {
  return trip.localEvents.map((e) => e.eventId);
}
