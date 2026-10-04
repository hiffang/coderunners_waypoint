import { assertSameOrigin, handle, ok, parseJson } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { runMutation } from "@/server/mutation";
import { loaderIssueSchema } from "@/shared/dto/issue";
import { reportIssue } from "@/features/loader/server/actions";

export const dynamic = "force-dynamic";

/** Shortfall/damage (blocking) or other loading issue. Replayable from the offline outbox. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/loader/trips/[id]/issues">) => {
  assertSameOrigin(req);
  const user = await requireRole("LOADER");
  const { id } = await ctx.params;
  const body = await parseJson(req, loaderIssueSchema);
  const result = await runMutation({
    req,
    actor: user,
    route: `POST /api/loader/trips/${id}/issues`,
    body,
    requireIdempotencyKey: true,
    fn: (mctx) => reportIssue(mctx, id, body),
  });
  return ok(result.data);
});
