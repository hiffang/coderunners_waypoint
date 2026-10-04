import { z } from "zod";
import { handle, ok, parseQuery } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { db } from "@/server/db";
import { localDate } from "@/server/time";
import { listQuerySchema } from "@/shared/dto/common";
import { toOrderDto } from "@/server/dto";
import { queue } from "@/features/dispatcher/server/service";
export const runtime = "nodejs";
export const GET = handle(async (req) => {
  const actor = await requireRole("DISPATCHER");
  const query = parseQuery(
    req,
    listQuerySchema.extend({
      brand: z.string().optional(),
      temp: z.string().optional(),
      district: z.string().optional(),
      access: z.string().optional(),
    }),
  );
  const rows = (
    await queue(db, actor, query.serviceDate ?? localDate())
  ).filter(
    (o) =>
      (!query.brand || o.brand === query.brand) &&
      (!query.temp || o.temp === query.temp) &&
      (!query.district || o.outlet.district === query.district) &&
      (!query.access || o.outlet.parkingConstraint === query.access),
  );
  const start = query.cursor
    ? rows.findIndex((o) => o.id === query.cursor) + 1
    : 0;
  const page = rows.slice(start, start + query.limit);
  return ok({
    items: page.map(toOrderDto),
    nextCursor: start + query.limit < rows.length ? page.at(-1)!.id : null,
  });
});
