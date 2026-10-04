import { assertSameOrigin, handle, ok, parseJson } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { runMutation } from "@/server/mutation";
import { driverActionSchema } from "@/shared/dto/manifest";
import { arriveAtStop } from "@/features/driver/server/actions";

export const dynamic = "force-dynamic";

/** pending -> arrived. May be replayed from the offline outbox with the same Idempotency-Key. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/driver/stops/[id]/arrive">) => {
  assertSameOrigin(req);
  const user = await requireRole("DRIVER");
  const { id } = await ctx.params;
  const body = await parseJson(req, driverActionSchema);
  const result = await runMutation({
    req,
    actor: user,
    route: `POST /api/driver/stops/${id}/arrive`,
    body,
    requireIdempotencyKey: true,
    fn: (mctx) => arriveAtStop(mctx, id, body),
  });
  return ok(result.data);
});