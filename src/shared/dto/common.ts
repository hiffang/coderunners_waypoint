import { z } from "zod";

/** Business date, YYYY-MM-DD in Asia/Colombo. */
export type LocalDate = string;
/** Instant, ISO-8601 UTC (e.g. 2026-09-26T00:30:00.000Z). */
export type IsoInstant = string;
/** Local wall time HH:mm in Asia/Colombo. */
export type LocalTime = string;

export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const instantSchema = z.iso.datetime({ offset: true });
export const idSchema = z.string().min(1).max(64);
export const expectedVersionSchema = z.number().int().min(1);
export const planRevisionSchema = z.number().int().min(1);
export const unitsSchema = z.number().int().min(0).max(100_000);
export const textSchema = (max = 1000) => z.string().trim().min(1).max(max);

/** List query: ?serviceDate=YYYY-MM-DD&cursor=...&limit=50 */
export const listQuerySchema = z.object({
  serviceDate: localDateSchema.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const versionOnlySchema = z.object({ expectedVersion: expectedVersionSchema });
export type VersionOnlyInput = z.infer<typeof versionOnlySchema>;

/** Body for loader/driver actions on a plan-revisioned trip. */
export const tripActionSchema = z.object({
  expectedVersion: expectedVersionSchema,
  planRevision: planRevisionSchema,
});
