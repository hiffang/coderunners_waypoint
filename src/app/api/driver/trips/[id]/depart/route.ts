import { assertSameOrigin, handle, ok, parseJson } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { runMutation } from "@/server/mutation";
import { driverActionSchema } from "@/shared/dto/manifest";
import { departTrip } from "@/features/driver/server/actions";

export const dynamic = "force-dynamic";

/** ready -> in_transit. Online only: the warehouse release and plan revision are checked here, never offline. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/driver/trips/[id]/depart">) => {
  assertSameOrigin(req);
  const user = await requireRole("DRIVER");
  const { id } = await ctx.params;
  const body = await parseJson(req, driverActionSchema);
  const result = await runMutation({
    req,
    actor: user,
    route: `POST /api/driver/trips/${id}/depart`,
    body,
    requireIdempotencyKey: true,
    fn: (mctx) => departTrip(mctx, id, body),
  });
  return ok(result.data);
});