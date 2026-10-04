import { z } from "zod";
import { DELIVERY_OUTCOMES, type Brand, type StopState, type Temp, type TripState } from "./enums";
import {
  expectedVersionSchema,
  idSchema,
  instantSchema,
  planRevisionSchema,
  unitsSchema,
  type IsoInstant,
  type LocalDate,
  type LocalTime,
} from "./common";
import type { AttachmentDto } from "./files";
import type { IssueDto } from "./issue";

export type TripSummaryDto = {
  id: string;
  planId: string;
  serviceDate: LocalDate;
  depotId: string;
  vehicleId: string;
  vehicleType: "TRUCK" | "VAN";
  refrigerated: boolean;
  tripNumber: number;
  brand: Brand;
  district: string;
  driver: { id: string; name: string } | null;
  state: TripState;
  planRevision: number;
  version: number;
  plannedDepartureAt: IsoInstant;
  plannedReturnAt: IsoInstant;
  distanceKm: number;
  reservedFuelLiters: number;
  stopCount: number;
  openBlockingIssues: number;
};

export type LoadingCheckDto = {
  orderLineId: string;
  expectedUnits: number;
  loadedUnits: number;
  damageUnits: number;
  note: string | null;
  planRevision: number;
  checkedAt: IsoInstant;
  checkedBy: { id: string; name: string };
};

export type ManifestLineDto = {
  orderLineId: string;
  lineNo: number;
  description: string;
  expectedUnits: number; // ordered units of the planned order
  unitWeightKg: number;
  unitVolumeM3: number;
  check: LoadingCheckDto | null; // null = not checked yet (differs from loaded 0)
};

export type ManifestOrderDto = {
  orderId: string;
  orderRef: string;
  temp: Temp;
  totals: { units: number; weightKg: number; volumeM3: number };
  lines: ManifestLineDto[];
};

export type ManifestStopDto = {
  stopId: string;
  sequence: number; // delivery order (1 = first stop)
  loadingSequence: number; // MVP: reverse of delivery ("load last delivery first")
  outletId: string;
  outletLabel: string;
  district: string;
  parkingConstraint: "NORMAL" | "VAN_ONLY" | "MALL_DOCK";
  windowOpen: LocalTime;
  windowClose: LocalTime;
  mallWindowOpen: LocalTime | null;
  mallWindowClose: LocalTime | null;
  plannedArrivalAt: IsoInstant;
  etaAt: IsoInstant | null;
  plannedServiceMin: number;
  state: StopState;
  version: number;
  orders: ManifestOrderDto[];
};

/** GET /api/loader/trips/[id]: complete versioned manifest. */
export type ManifestDto = TripSummaryDto & {
  capacity: { weightCapKg: number; volumeCapM3: number };
  load: { weightKg: number; volumeM3: number };
  stops: ManifestStopDto[]; // ordered by delivery sequence
  issues: IssueDto[];
};

export type DriverStopEventsDto = {
  actualArrivalAt: IsoInstant | null;
  completedAt: IsoInstant | null;
  proof: {
    outcome: "DELIVERED" | "PARTIAL" | "FAILED";
    recipientName: string | null;
    note: string | null;
    failureReason: string | null;
    capturedAt: IsoInstant;
    submittedAt: IsoInstant;
    attachments: AttachmentDto[];
  } | null;
  lineOutcomes: Array<{ orderLineId: string; loadedUnitsSnapshot: number; deliveredUnits: number; damagedUnits: number }>;
};

/** GET /api/driver/trips/[id]: manifest plus actual events. Safe to cache offline for this driver only. */
export type DriverSnapshotDto = ManifestDto & {
  departedAt: IsoInstant | null;
  returnedAt: IsoInstant | null;
  stopEvents: Record<string, DriverStopEventsDto>; // keyed by stopId
  snapshotAt: IsoInstant; // server time the snapshot was built
};

// ---------------------------------------------------------------- loader inputs

/** POST /api/loader/trips/[id]/start and /ready */
export const loaderTripActionSchema = z.object({
  expectedVersion: expectedVersionSchema,
  planRevision: planRevisionSchema,
});
export type LoaderTripActionInput = z.infer<typeof loaderTripActionSchema>;

/** PUT /api/loader/trips/[id]/checks: atomic batch, bumps Trip.version once. */
export const loadingChecksSchema = z.object({
  expectedVersion: expectedVersionSchema,
  planRevision: planRevisionSchema,
  checks: z
    .array(
      z.object({
        orderLineId: idSchema,
        loadedUnits: unitsSchema,
        damageUnits: unitsSchema,
        note: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(500),
});
export type LoadingChecksInput = z.infer<typeof loadingChecksSchema>;

// ---------------------------------------------------------------- driver inputs

/** depart / arrive / return. Trip actions use Trip.version, arrive uses Stop.version. */
export const driverActionSchema = z.object({
  expectedVersion: expectedVersionSchema,
  planRevision: planRevisionSchema,
  clientAt: instantSchema,
});
export type DriverActionInput = z.infer<typeof driverActionSchema>;

/** POST /api/driver/stops/[id]/outcome */
export const stopOutcomeSchema = z
  .object({
    expectedVersion: expectedVersionSchema, // Stop.version
    planRevision: planRevisionSchema,
    outcome: z.enum(DELIVERY_OUTCOMES),
    recipientName: z.string().trim().max(120).optional(),
    note: z.string().trim().max(1000).optional(),
    failureReason: z.string().trim().max(500).optional(),
    evidenceFileIds: z.array(idSchema).max(5).default([]),
    lines: z.array(
      z.object({ orderLineId: idSchema, deliveredUnits: unitsSchema, damagedUnits: unitsSchema }),
    ),
    clientAt: instantSchema,
  })
  .superRefine((v, ctx) => {
    if (v.outcome === "FAILED" && !v.failureReason) {
      ctx.addIssue({ code: "custom", path: ["failureReason"], message: "Required when delivery failed" });
    }
    // Team evidence choice: successful/partial delivery needs a recipient name OR a photo.
    if (v.outcome !== "FAILED" && !v.recipientName && v.evidenceFileIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["recipientName"], message: "Recipient name or a photo is required" });
    }
    for (const [i, l] of v.lines.entries()) {
      if (l.damagedUnits > l.deliveredUnits) {
        ctx.addIssue({ code: "custom", path: ["lines", i, "damagedUnits"], message: "Damaged cannot exceed delivered" });
      }
    }
  });
export type StopOutcomeInput = z.infer<typeof stopOutcomeSchema>;
