// Client-safe mirrors of the Prisma enums (prisma/schema.prisma). Keep in sync;
// tests/unit/contract.test.ts fails if they drift.

export const BRANDS = ["FRESH", "STYLE", "TECH"] as const;
export type Brand = (typeof BRANDS)[number];

export const TEMPS = ["AMBIENT", "CHILLED", "FROZEN"] as const;
export type Temp = (typeof TEMPS)[number];

export const VEHICLE_TYPES = ["TRUCK", "VAN"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_STATUSES = ["AVAILABLE", "IN_WORKSHOP"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const DOCK_TYPES = ["STREET", "REAR_DOCK", "MALL_BAY"] as const;
export type DockType = (typeof DOCK_TYPES)[number];

export const PARKING_CONSTRAINTS = ["NORMAL", "VAN_ONLY", "MALL_DOCK"] as const;
export type ParkingConstraint = (typeof PARKING_CONSTRAINTS)[number];

export const ORDER_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "DEFERRED",
  "ALLOCATED",
  "DELIVERED",
  "PARTIALLY_DELIVERED",
  "RECEIVED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PLAN_STATUSES = ["DRAFT", "PUBLISHED", "COMPLETED"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const DECISION_TYPES = ["SERVED", "DEFERRED"] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

export const DEFERRAL_REASONS = [
  "CAPACITY_WEIGHT",
  "CAPACITY_VOLUME",
  "NO_REFRIGERATED_VEHICLE",
  "ACCESS_VAN_ONLY",
  "ACCESS_MALL_WINDOW",
  "DELIVERY_WINDOW",
  "FUEL_QUOTA",
  "TRIP_LIMIT",
  "VEHICLE_UNAVAILABLE",
  "DELIVERY_FAILED",
  "OTHER",
] as const;
export type DeferralReason = (typeof DEFERRAL_REASONS)[number];

export const TRIP_STATES = ["PLANNED", "LOADING", "READY", "IN_TRANSIT", "COMPLETED"] as const;
export type TripState = (typeof TRIP_STATES)[number];

export const STOP_STATES = ["PENDING", "ARRIVED", "DELIVERED", "PARTIAL", "FAILED"] as const;
export type StopState = (typeof STOP_STATES)[number];

export const ISSUE_TYPES = ["SHORTFALL", "DAMAGE", "DELAY", "ACCESS", "RECEIPT", "OTHER"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const ISSUE_SEVERITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export const ISSUE_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const DELIVERY_OUTCOMES = ["DELIVERED", "PARTIAL", "FAILED"] as const;
export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number];

export const RECEIPT_STATUSES = ["CONFIRMED", "DISPUTED"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const FUEL_RESERVATION_STATES = ["RESERVED", "CONSUMED", "RELEASED"] as const;
export type FuelReservationState = (typeof FUEL_RESERVATION_STATES)[number];

/** Temperatures that need a refrigerated vehicle. */
export const REFRIGERATED_TEMPS: readonly Temp[] = ["CHILLED", "FROZEN"];

/** Temps a store may order per brand (MVP rule, TEAM_CONTRACT / Member 4). */
export const BRAND_TEMPS: Record<Brand, readonly Temp[]> = {
  FRESH: ["AMBIENT", "CHILLED"],
  STYLE: ["AMBIENT"],
  TECH: ["AMBIENT"],
};

/** Small tolerance for capacity/fuel comparisons on decimals (kg, m3, L). UI rounding never relaxes it. */
export const CAPACITY_TOLERANCE = 1e-6;
