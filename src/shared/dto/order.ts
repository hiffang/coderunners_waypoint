import { z } from "zod";
import {
  TEMPS,
  type Brand,
  type DeferralReason,
  type DeliveryOutcome,
  type OrderStatus,
  type ReceiptStatus,
  type StopState,
  type Temp,
} from "./enums";
import { expectedVersionSchema, idSchema, localDateSchema, textSchema, type IsoInstant, type LocalDate } from "./common";
import type { AttachmentDto } from "./files";

export type OrderLineDto = {
  id: string;
  lineNo: number;
  description: string;
  orderedUnits: number;
  unitWeightKg: number;
  unitVolumeM3: number;
  /** Filled once known; null before loading / delivery / receipt. */
  loadedUnits: number | null;
  deliveredUnits: number | null;
  deliveryDamagedUnits: number | null;
  receivedUnits: number | null;
  receiptDamageUnits: number | null;
};

export type OrderAllocationDto = {
  planId: string;
  planRevision: number;
  serviceDate: LocalDate;
  tripId: string;
  tripNumber: number;
  vehicleId: string;
  stopId: string;
  stopSequence: number;
  plannedArrivalAt: IsoInstant;
  etaAt: IsoInstant | null;
};

export type OrderDeferralDto = {
  planId: string;
  serviceDate: LocalDate; // run the order missed
  reasonCode: DeferralReason;
  reasonText: string;
  nextEligibleDate: LocalDate;
};

export type OrderDeliveryDto = {
  stopId: string;
  stopState: StopState;
  arrivedAt: IsoInstant | null;
  outcome: DeliveryOutcome | null;
  recipientName: string | null;
  failureReason: string | null;
  submittedAt: IsoInstant | null; // server-acknowledged
  evidence: AttachmentDto[];
};

export type OrderReceiptDto = {
  id: string;
  status: ReceiptStatus;
  receivedAt: IsoInstant;
  note: string | null;
  version: number;
};

/** Shared order DTO (TEAM_CONTRACT section 6). Store and dispatcher read the same shape. */
export type OrderDto = {
  id: string;
  orderRef: string;
  outletId: string;
  outletLabel: string;
  district: string;
  depotId: string;
  brand: Brand;
  temp: Temp;
  requestedDate: LocalDate;
  eligibleServiceDate: LocalDate;
  submittedAt: IsoInstant | null;
  status: OrderStatus;
  version: number;
  totals: { units: number; weightKg: number; volumeM3: number };
  lines: OrderLineDto[];
  allocation: OrderAllocationDto | null; // latest SERVED decision in a published plan
  deferral: OrderDeferralDto | null; // latest DEFERRED decision in a published plan
  /** Distinct published service days on which this order was deferred (fairness history). */
  priorDeferrals: Array<{ serviceDate: LocalDate; reasonCode: DeferralReason }>;
  delivery: OrderDeliveryDto | null;
  receipt: OrderReceiptDto | null;
  followUpOfId: string | null;
};

// ---------------------------------------------------------------- store inputs

export const orderLineInputSchema = z.object({
  description: textSchema(200),
  orderedUnits: z.number().int().min(1).max(100_000),
  unitWeightKg: z.number().min(0).max(10_000),
  unitVolumeM3: z.number().min(0).max(100),
});
export type OrderLineInput = z.infer<typeof orderLineInputSchema>;

/** POST /api/store/orders. Outlet, brand, totals and eligibility come from the server. */
export const createOrderSchema = z.object({
  requestedDate: localDateSchema,
  temp: z.enum(TEMPS),
  lines: z.array(orderLineInputSchema).min(1).max(50),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/** PATCH /api/store/orders/[id] */
export const updateOrderSchema = z.object({
  expectedVersion: expectedVersionSchema,
  requestedDate: localDateSchema.optional(),
  temp: z.enum(TEMPS).optional(),
  lines: z.array(orderLineInputSchema).min(1).max(50).optional(),
});
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;

/** POST /api/store/orders/[id]/cancel */
export const cancelOrderSchema = z.object({
  expectedVersion: expectedVersionSchema,
  reason: textSchema(500),
});
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

/** POST /api/store/orders/[id]/receipt. Any discrepancy makes the receipt DISPUTED and opens an Issue. */
export const receiptSchema = z.object({
  expectedVersion: expectedVersionSchema, // Order.version
  lines: z
    .array(
      z.object({
        orderLineId: idSchema,
        receivedUnits: z.number().int().min(0),
        damageUnits: z.number().int().min(0),
      }),
    )
    .min(1),
  note: z.string().trim().max(1000).optional(),
  attachmentIds: z.array(idSchema).max(5).default([]),
});
export type ReceiptInput = z.infer<typeof receiptSchema>;

// ---------------------------------------------------------------- dispatcher inputs

/** POST /api/dispatcher/orders/[id]/defer: only after a fully failed, terminal delivery. */
export const deferOrderSchema = z.object({
  expectedVersion: expectedVersionSchema,
  reasonCode: z.literal("DELIVERY_FAILED").or(z.literal("OTHER")),
  reasonText: textSchema(),
});
export type DeferOrderInput = z.infer<typeof deferOrderSchema>;
