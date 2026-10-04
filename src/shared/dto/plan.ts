import { z } from "zod";
import {
  DECISION_TYPES,
  DEFERRAL_REASONS,
  type Brand,
  type DecisionType,
  type DeferralReason,
  type PlanStatus,
} from "./enums";
import { expectedVersionSchema, idSchema, localDateSchema, type IsoInstant, type LocalDate } from "./common";
import type { TripSummaryDto } from "./manifest";
import type { IssueDto } from "./issue";

export type PlanSummaryDto = {
  id: string;
  depotId: string;
  serviceDate: LocalDate;
  status: PlanStatus;
  revision: number; // 0 until first publish
  version: number;
  publishedAt: IsoInstant | null;
  counts: { orders: number; served: number; deferred: number; undecided: number; trips: number };
};

export type DecisionDto = {
  orderId: string;
  orderRef: string;
  decision: DecisionType;
  tripId: string | null;
  stopId: string | null;
  reasonCode: DeferralReason | null;
  reasonText: string | null;
  nextEligibleDate: LocalDate | null;
  priorityNote: string | null;
};

export type UtilizationDto = {
  tripId: string;
  weightKg: number;
  weightCapKg: number;
  volumeM3: number;
  volumeCapM3: number;
  fuelLiters: number;
  weekFuelUsedLiters: number; // reserved + consumed by other trips this ISO week
  weekFuelQuotaLiters: number;
};

/** GET /api/dispatcher/plans/[id] */
export type PlanDto = PlanSummaryDto & {
  decisions: DecisionDto[];
  trips: TripSummaryDto[];
  utilization: UtilizationDto[];
  issues: IssueDto[];
};

/** One failed rule. `amount` states the exceeded quantity where it applies. */
export type ConstraintViolation = {
  code:
    | "NOT_ELIGIBLE"
    | "WRONG_DEPOT"
    | "ALREADY_SERVED"
    | "MISSING_DECISION"
    | "VEHICLE_UNAVAILABLE"
    | "TRIP_LIMIT"
    | "NO_DRIVER"
    | "REFRIGERATION"
    | "VAN_ONLY"
    | "WEIGHT"
    | "VOLUME"
    | "WINDOW"
    | "MALL_WINDOW"
    | "SEQUENTIAL_TRIP"
    | "FUEL_QUOTA"
    | "DEFERRAL_REASON"
    | "MISSING_INPUT";
  message: string;
  orderId?: string;
  tripId?: string;
  vehicleId?: string;
  amount?: { value: number; limit: number; unit: "kg" | "m3" | "L" | "min" | "trips" };
};

/** POST /api/dispatcher/plans/[id]/validate (read-only) and the 422 body of publish. */
export type PlanValidationDto = {
  planId: string;
  version: number;
  valid: boolean;
  violations: ConstraintViolation[];
};

export const createPlanSchema = z.object({ depotId: idSchema, serviceDate: localDateSchema });
export type CreatePlanInput = z.infer<typeof createPlanSchema>;

/** PUT /api/dispatcher/plans/[id]/decisions: replaces all draft decisions atomically. */
export const planDecisionsSchema = z.object({
  expectedVersion: expectedVersionSchema,
  decisions: z
    .array(
      z.object({
        orderId: idSchema,
        decision: z.enum(DECISION_TYPES),
        vehicleId: idSchema.optional(),
        tripNumber: z.union([z.literal(1), z.literal(2)]).optional(),
        stopSequence: z.number().int().min(1).optional(),
        reasonCode: z.enum(DEFERRAL_REASONS).optional(),
        reasonText: z.string().trim().max(1000).optional(),
      }),
    )
    .max(1000),
});
export type PlanDecisionsInput = z.infer<typeof planDecisionsSchema>;

/** Deterministic priority explanation shown next to each decision. */
export type PriorityExplanation = { tier: number; label: string; brand: Brand; priorDeferrals: number };
