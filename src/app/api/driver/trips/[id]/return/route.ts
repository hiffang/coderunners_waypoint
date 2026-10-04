import { assertSameOrigin, handle, ok, parseJson } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { runMutation } from "@/server/mutation";
import { driverActionSchema } from "@/shared/dto/manifest";
import { returnTrip } from "@/features/driver/server/actions";

export const dynamic = "force-dynamic";

/** in_transit -> completed once every stop is terminal; converts the fuel reservation to consumption exactly once. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/driver/trips/[id]/return">) => {
  assertSameOrigin(req);
  const user = await requireRole("DRIVER");
  const { id } = await ctx.params;
  const body = await parseJson(req, driverActionSchema);
  const result = await runMutation({
    req,
    actor: user,
    route: `POST /api/driver/trips/${id}/return`,
    body,
    requireIdempotencyKey: true,
    fn: (mctx) => returnTrip(mctx, id, body),
  });
  return ok(result.data);
});