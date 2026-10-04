import { handle, ok, assertSameOrigin, parseJson } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { runMutation } from "@/server/mutation";
export const runtime = "nodejs";
import { createPlanSchema } from "@/shared/dto/plan";
import { listQuerySchema } from "@/shared/dto/common";
import { parseQuery } from "@/server/http";
import { localDate } from "@/server/time";
import { createPlan, listPlans } from "@/features/dispatcher/server/service";
export const GET = handle(async (req) => {
  const actor = await requireRole("DISPATCHER");
  const query = parseQuery(req, listQuerySchema);
  return ok({
    items: await listPlans(actor, query.serviceDate ?? localDate()),
    nextCursor: null,
  });
});
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const actor = await requireRole("DISPATCHER");
  const body = await parseJson(req, createPlanSchema);
  const result = await runMutation({
    req,
    actor,
    route: "POST /dispatcher/plans",
    body,
    requireIdempotencyKey: true,
    fn: (ctx) => createPlan(ctx, body.depotId, body.serviceDate),
  });
  return ok(result.data);
});
