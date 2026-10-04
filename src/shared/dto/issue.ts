import { z } from "zod";
import { ISSUE_SEVERITIES, ISSUE_TYPES, type IssueSeverity, type IssueStatus, type IssueType } from "./enums";
import { expectedVersionSchema, idSchema, instantSchema, planRevisionSchema, textSchema, type IsoInstant } from "./common";
import type { Role } from "@/shared/roles";
import type { AttachmentDto } from "./files";

export type IssueDto = {
  id: string;
  type: IssueType;
  severity: IssueSeverity;
  blocking: boolean;
  status: IssueStatus;
  text: string;
  orderId: string | null;
  orderRef: string | null;
  tripId: string | null;
  stopId: string | null;
  orderLineId: string | null;
  reporter: { id: string; name: string; role: Role };
  resolution: string | null;
  resolvedBy: { id: string; name: string } | null;
  createdAt: IsoInstant;
  acknowledgedAt: IsoInstant | null;
  resolvedAt: IsoInstant | null;
  version: number;
  attachments: AttachmentDto[];
};

/** POST /api/loader/trips/[id]/issues */
export const loaderIssueSchema = z.object({
  expectedVersion: expectedVersionSchema, // Trip.version
  planRevision: planRevisionSchema,
  type: z.enum(["SHORTFALL", "DAMAGE", "OTHER"]),
  severity: z.enum(ISSUE_SEVERITIES),
  orderId: idSchema.optional(),
  orderLineId: idSchema.optional(),
  text: textSchema(),
});
export type LoaderIssueInput = z.infer<typeof loaderIssueSchema>;

/** POST /api/driver/stops/[id]/issues */
export const driverIssueSchema = z.object({
  expectedVersion: expectedVersionSchema, // Stop.version
  planRevision: planRevisionSchema,
  type: z.enum(["DELAY", "ACCESS", "DAMAGE", "OTHER"]),
  severity: z.enum(ISSUE_SEVERITIES),
  text: textSchema(),
  clientAt: instantSchema,
});
export type DriverIssueInput = z.infer<typeof driverIssueSchema>;

/** POST /api/store/orders/[id]/issues */
export const storeIssueSchema = z.object({
  expectedVersion: expectedVersionSchema, // Order.version
  type: z.enum(ISSUE_TYPES),
  severity: z.enum(ISSUE_SEVERITIES),
  text: textSchema(),
  attachmentIds: z.array(idSchema).max(5).default([]),
});
export type StoreIssueInput = z.infer<typeof storeIssueSchema>;

/** POST /api/dispatcher/issues/[id]/resolve */
export const resolveIssueSchema = z.object({
  expectedVersion: expectedVersionSchema, // Issue.version
  action: z.enum(["ACKNOWLEDGE", "RESOLVE"]),
  resolution: textSchema(),
});
export type ResolveIssueInput = z.infer<typeof resolveIssueSchema>;
