import { assertSameOrigin, handle, ok, parseJson } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { runMutation } from "@/server/mutation";
import { loadingChecksSchema } from "@/shared/dto/manifest";
import { recordChecks } from "@/features/loader/server/actions";

export const dynamic = "force-dynamic";

/** Atomic batch of line checks; bumps Trip.version once. Replayable from the offline outbox. */
export const PUT = handle(async (req: Request, ctx: RouteContext<"/api/loader/trips/[id]/checks">) => {
  assertSameOrigin(req);
  const user = await requireRole("LOADER");
  const { id } = await ctx.params;
  const body = await parseJson(req, loadingChecksSchema);
  const result = await runMutation({
    req,
    actor: user,
    route: `PUT /api/loader/trips/${id}/checks`,
    body,
    requireIdempotencyKey: true,
    fn: (mctx) => recordChecks(mctx, id, body),
  });
  return ok(result.data);
});
