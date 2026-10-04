import { assertSameOrigin, handle, ok, parseJson } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { runMutation } from "@/server/mutation";
import { stopOutcomeSchema } from "@/shared/dto/manifest";
import { recordOutcome } from "@/features/driver/server/actions";

export const dynamic = "force-dynamic";

/** arrived -> delivered/partial/failed with proof, line quantities, evidence links and parent order status in one transaction. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/driver/stops/[id]/outcome">) => {
  assertSameOrigin(req);
  const user = await requireRole("DRIVER");
  const { id } = await ctx.params;
  const body = await parseJson(req, stopOutcomeSchema);
  const result = await runMutation({
    req,
    actor: user,
    route: `POST /api/driver/stops/${id}/outcome`,
    body,
    requireIdempotencyKey: true,
    fn: (mctx) => recordOutcome(mctx, id, body),
  });
  return ok(result.data);
});