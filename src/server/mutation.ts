import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/server/db";
import { HttpError, badRequest, conflict, revisionConflict, versionConflict } from "@/server/http";
import type { SessionUser } from "@/server/auth/guards";
import { IDEMPOTENCY_HEADER } from "@/shared/api";

export type AuditEntry = {
  action: string; // "<entity>.<verb>", e.g. "trip.depart", "order.submit"
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  clientAt?: Date | string | null; // device time for offline replays (informational)
  planRevision?: number | null;
};

export async function writeAudit(tx: Tx, actorId: string, entry: AuditEntry) {
  await tx.auditLog.create({
    data: {
      actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: toJson(entry.before),
      after: toJson(entry.after),
      clientAt: entry.clientAt ? new Date(entry.clientAt) : null,
      planRevision: entry.planRevision ?? null,
    },
  });
}

/** Throw 409 VERSION_CONFLICT unless the stored version matches what the client saw. */
export function assertVersion(expected: number, actual: number) {
  if (expected !== actual) throw versionConflict(expected, actual);
}

/** Throw 409 REVISION_CONFLICT unless the client acted on the current plan revision. */
export function assertRevision(expected: number, actual: number) {
  if (expected !== actual) throw revisionConflict(expected, actual);
}

type MutationContext = { tx: Tx; actor: SessionUser; audit: (entry: AuditEntry) => Promise<void> };

/**
 * Standard write path for every state-changing API.
 *
 * - `actor`: the authenticated user (already scope-checked by the caller).
 * - Idempotency: when the request carries an Idempotency-Key header (required
 *   for offline outbox replays), the first successful result is stored and
 *   replayed for identical retries. Reusing a key with a different body is a 409.
 * - Runs `fn` in one serializable transaction together with audit rows.
 * - Optimistic concurrency: `fn` should call `assertVersion(expectedVersion, row.version)`
 *   and increment `version` on the rows it changes.
 */
export async function runMutation<T>(opts: {
  req: Request;
  actor: SessionUser;
  route: string;
  body: unknown;
  requireIdempotencyKey?: boolean;
  fn: (ctx: MutationContext) => Promise<T>;
}): Promise<{ status: number; data: T; replayed: boolean }> {
  const key = opts.req.headers.get(IDEMPOTENCY_HEADER);
  if (opts.requireIdempotencyKey && !key) throw badRequest(`${IDEMPOTENCY_HEADER} header required`);
  if (key && (key.length < 8 || key.length > 128)) throw badRequest("Invalid idempotency key");
  const requestHash = hash(JSON.stringify(opts.body ?? null));

  if (key) {
    const existing = await db.idempotencyKey.findUnique({ where: { key } });
    if (existing) return replay<T>(existing, opts.actor.id, opts.route, requestHash);
  }

  try {
    return await db.$transaction(
      async (tx) => {
        const ctx: MutationContext = {
          tx,
          actor: opts.actor,
          audit: (entry) => writeAudit(tx, opts.actor.id, entry),
        };
        const data = await opts.fn(ctx);
        if (key) {
          await tx.idempotencyKey.create({
            data: {
              key,
              actorId: opts.actor.id,
              route: opts.route,
              requestHash,
              statusCode: 200,
              responseBody: toJson(data) ?? Prisma.JsonNull,
            },
          });
        }
        return { status: 200, data, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (err) {
    // Concurrent retry with the same key won the race: replay its stored result.
    if (key && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await db.idempotencyKey.findUnique({ where: { key } });
      if (existing) return replay<T>(existing, opts.actor.id, opts.route, requestHash);
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
      throw new HttpError(409, "CONFLICT", "Concurrent update, please retry");
    }
    throw err;
  }
}

function replay<T>(
  row: { actorId: string; route: string; requestHash: string; statusCode: number; responseBody: unknown },
  actorId: string,
  route: string,
  requestHash: string,
) {
  if (row.actorId !== actorId || row.route !== route || row.requestHash !== requestHash) {
    throw conflict("Idempotency key already used for a different request");
  }
  return { status: row.statusCode, data: row.responseBody as T, replayed: true };
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
