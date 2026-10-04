import { assertSameOrigin, handle, ok, parseJson } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { runMutation } from "@/server/mutation";
import { loaderTripActionSchema } from "@/shared/dto/manifest";
import { startLoading } from "@/features/loader/server/actions";

export const dynamic = "force-dynamic";

/** planned -> loading on the current published revision. Replayable from the offline outbox. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/loader/trips/[id]/start">) => {
  assertSameOrigin(req);
  const user = await requireRole("LOADER");
  const { id } = await ctx.params;
  const body = await parseJson(req, loaderTripActionSchema);
  const result = await runMutation({
    req,
    actor: user,
    route: `POST /api/loader/trips/${id}/start`,
    body,
    requireIdempotencyKey: true,
    fn: (mctx) => startLoading(mctx, id, body),
  });
  return ok(result.data);
});
