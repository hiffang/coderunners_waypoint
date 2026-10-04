import { z } from "zod";
import { requireRole, assertOutletScope } from "@/server/auth/guards";
import {
  assertSameOrigin,
  handle,
  ok,
  parseJson,
  parseQuery,
  forbidden,
  notFound,
} from "@/server/http";
import { db } from "@/server/db";
import { orderInclude, toOrderDto } from "@/server/dto";
import { runMutation } from "@/server/mutation";
import { createOrderSchema } from "@/shared/dto/order";
import { idSchema, localDateSchema } from "@/shared/dto/common";
import { ORDER_STATUSES } from "@/shared/dto/enums";
import { calendarFor, createOrder } from "@/features/store/server/service";
export const dynamic = "force-dynamic";
const querySchema = z.object({
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  serviceDate: localDateSchema.optional(),
  status: z.enum(ORDER_STATUSES).optional(),
});
export const GET = handle(async (req: Request) => {
  const user = await requireRole("STORE");
  if (!user.outletId) throw forbidden("Account has no outlet");
  assertOutletScope(user, user.outletId);
  const query = parseQuery(req, querySchema);
  const cursor = query.cursor
    ? await db.order.findFirst({
        where: { id: query.cursor, outletId: user.outletId },
        select: { id: true, createdAt: true },
      })
    : null;
  if (query.cursor && !cursor) throw notFound("Order cursor not found");
  const rows = await db.order.findMany({
    where: {
      outletId: user.outletId,
      ...(query.serviceDate ? { eligibleServiceDate: query.serviceDate } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    include: orderInclude,
  });
  const more = rows.length > query.limit;
  const items = rows.slice(0, query.limit);
  return ok({
    items: items.map(toOrderDto),
    nextCursor: more ? items.at(-1)!.id : null,
  });
});
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const actor = await requireRole("STORE");
  const body = await parseJson(req, createOrderSchema);
  const lookup = await calendarFor(body.requestedDate);
  const result = await runMutation({
    req,
    actor,
    route: "POST /api/store/orders",
    body,
    requireIdempotencyKey: true,
    fn: (ctx) => createOrder(ctx, body, lookup),
  });
  return ok(result.data);
});
