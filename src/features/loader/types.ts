// Client-safe loader DTOs. They extend the frozen shared shapes in
// src/shared/dto/manifest.ts without changing them.
import { z } from "zod";
import { expectedVersionSchema, planRevisionSchema, textSchema, type IsoInstant, type LocalDate } from "@/shared/dto/common";
import type { TripState } from "@/shared/dto/enums";
import type { IssueDto } from "@/shared/dto/issue";
import type { ManifestDto, TripSummaryDto } from "@/shared/dto/manifest";

/** Why the trip can (not) be released to the driver. Evaluated by the server; the client only displays it. */
export type LoadingReadiness = {
  canRelease: boolean;
  blockers: string[];
  totalLines: number;
  /** Lines with a check against the trip's current plan revision. */
  checkedLines: number;
  /** Lines checked against an older plan revision: they must be re-checked. */
  staleLines: number;
  shortLines: number;
  damagedLines: number;
  openBlockingIssues: number;
};

/** GET /api/loader/trips item. */
export type LoaderTripListItemDto = TripSummaryDto & {
  planPublishedAt: IsoInstant | null;
  readiness: LoadingReadiness;
};

export type LoaderTripListDto = {
  items: LoaderTripListItemDto[];
  serverTime: IsoInstant;
};

/** GET /api/loader/trips/[id]: shared manifest plus release status. Safe to cache for this loader's depot only. */
export type LoaderManifestDto = ManifestDto & {
  depotName: string;
  planPublishedAt: IsoInstant | null;
  loadingStartedAt: IsoInstant | null;
  readyAt: IsoInstant | null;
  departedAt: IsoInstant | null;
  readiness: LoadingReadiness;
  serverTime: IsoInstant;
};

/** Result of every loader mutation. Stored by the idempotency layer, so a retry gets exactly this body back. */
export type LoaderMutationResult = {
  tripId: string;
  version: number;
  planRevision: number;
  state: TripState;
  serverAt: IsoInstant;
  issueId?: string;
  checkedLines?: number;
};

/** GET /api/loader/issues item: an issue on one of this depot's trips. */
export type LoaderIssueListItemDto = IssueDto & {
  trip: { id: string; vehicleId: string; tripNumber: number; serviceDate: LocalDate; state: TripState };
};

export type LoaderIssueListDto = { items: LoaderIssueListItemDto[]; serverTime: IsoInstant };

/**
 * POST /api/loader/trips/[id]/issues/[issueId]/resolve. The loader may close a
 * shortfall/damage issue only after the server verifies corrective checks;
 * it is never an override.
 */
export const loaderResolveIssueSchema = z.object({
  expectedVersion: expectedVersionSchema, // Trip.version
  planRevision: planRevisionSchema,
  issueVersion: expectedVersionSchema, // Issue.version
  resolution: textSchema(500),
});
export type LoaderResolveIssueInput = z.infer<typeof loaderResolveIssueSchema>;
