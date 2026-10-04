import { assertSameOrigin, handle, ok, parseJson } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { runMutation } from "@/server/mutation";
import { loaderTripActionSchema } from "@/shared/dto/manifest";
import { releaseTrip } from "@/features/loader/server/actions";

export const dynamic = "force-dynamic";

/** loading -> ready. Online only: the client never queues this; every release condition is checked here. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/loader/trips/[id]/ready">) => {
  assertSameOrigin(req);
  const user = await requireRole("LOADER");
  const { id } = await ctx.params;
  const body = await parseJson(req, loaderTripActionSchema);
  const result = await runMutation({
    req,
    actor: user,
    route: `POST /api/loader/trips/${id}/ready`,
    body,
    requireIdempotencyKey: true,
    fn: (mctx) => releaseTrip(mctx, id, body),
  });
  return ok(result.data);
});
