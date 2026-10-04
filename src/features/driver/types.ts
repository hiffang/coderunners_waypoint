// Client-safe driver DTOs. They extend the frozen shared shapes in
// src/shared/dto/manifest.ts without changing them.
import type { DriverSnapshotDto, TripSummaryDto } from "@/shared/dto/manifest";
import type { IsoInstant } from "@/shared/dto/common";
import type { StopState, TripState } from "@/shared/dto/enums";

/** Why the driver may (not) depart right now. Evaluated server-side; the client only displays it. */
export type DepartureReadiness = {
  canDepart: boolean;
  blockers: string[];
};

/** GET /api/driver/trips item. */
export type DriverTripListItemDto = TripSummaryDto & {
  departedAt: IsoInstant | null;
  returnedAt: IsoInstant | null;
  terminalStops: number;
  departure: DepartureReadiness;
};

export type DriverTripListDto = {
  items: DriverTripListItemDto[];
  serverTime: IsoInstant;
};

/** GET /api/driver/trips/[id]: shared snapshot plus readiness and home depot. */
export type DriverTripSnapshotDto = DriverSnapshotDto & {
  depotName: string;
  departure: DepartureReadiness;
};

/**
 * Result of every driver mutation. Stored by the idempotency layer, so a retry
 * of the same event gets exactly this body back.
 */
export type DriverMutationResult = {
  entityType: "Trip" | "Stop";
  entityId: string;
  tripId: string;
  version: number;
  state: TripState | StopState;
  serverAt: IsoInstant;
  proofId?: string;
  issueId?: string;
  attachmentIds?: string[];
  fuel?: { liters: number; estimated: true; state: "CONSUMED" } | null;
};

export const TERMINAL_STOP_STATES: readonly StopState[] = ["DELIVERED", "PARTIAL", "FAILED"];
