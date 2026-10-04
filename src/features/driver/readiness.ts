// Pure departure rules shared by the depart endpoint, the trip list and the
// snapshot. The server is the only caller that decides; the UI shows the result.
import type { PlanStatus, TripState, VehicleStatus } from "@/shared/dto/enums";
import type { DepartureReadiness } from "./types";

export type ReadinessInput = {
  state: TripState;
  tripNumber: number;
  planStatus: PlanStatus;
  vehicleStatus: VehicleStatus;
  assignedToActor: boolean;
  openBlockingIssues: number;
  planRevision: number;
  /** Every order line planned on the trip. */
  lineIds: string[];
  /** Loader checks recorded on the trip. */
  checks: Array<{ orderLineId: string; planRevision: number }>;
  /** Same vehicle, same service date, lower trip number. */
  earlierTrips: Array<{ tripNumber: number; state: TripState; returnedAt: Date | string | null }>;
  /** Another trip of this vehicle is on the road (any date). */
  vehicleBusyElsewhere: boolean;
};

export function departureReadiness(t: ReadinessInput): DepartureReadiness {
  const blockers: string[] = [];
  if (t.state === "IN_TRANSIT" || t.state === "COMPLETED") {
    return { canDepart: false, blockers: ["Trip has already departed"] };
  }
  if (!t.assignedToActor) blockers.push("Trip is not assigned to you");
  if (t.tripNumber !== 1 && t.tripNumber !== 2) blockers.push("A vehicle runs at most two trips a day");
  if (t.planStatus !== "PUBLISHED") blockers.push("Plan is not published");
  if (t.state !== "READY") {
    blockers.push(
      t.state === "LOADING" ? "Loading is still in progress at the warehouse" : "Warehouse has not started loading",
    );
  }
  if (t.openBlockingIssues > 0) {
    blockers.push(`${t.openBlockingIssues} loading issue${t.openBlockingIssues > 1 ? "s" : ""} not resolved`);
  }
  if (t.state === "READY") {
    const current = new Set(t.checks.filter((c) => c.planRevision === t.planRevision).map((c) => c.orderLineId));
    const missing = t.lineIds.filter((id) => !current.has(id)).length;
    if (missing > 0) blockers.push(`${missing} line${missing > 1 ? "s" : ""} not checked against plan revision ${t.planRevision}`);
  }
  if (t.vehicleStatus !== "AVAILABLE") blockers.push("Vehicle is in the workshop");
  const unreturned = t.earlierTrips.filter((e) => e.state !== "COMPLETED" || !e.returnedAt);
  if (unreturned.length > 0) blockers.push(`Trip ${unreturned[0].tripNumber} has not returned to the depot yet`);
  if (t.vehicleBusyElsewhere) blockers.push("Vehicle is still on another trip");
  return { canDepart: blockers.length === 0, blockers };
}
