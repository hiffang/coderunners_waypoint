import { assertSameOrigin, handle, ok, parseJson } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { runMutation } from "@/server/mutation";
import { resolveIssue } from "@/features/loader/server/actions";
import { loaderResolveIssueSchema } from "@/features/loader/types";

export const dynamic = "force-dynamic";

/** Close a shortfall/damage issue once the server has verified corrective checks. Online only. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/loader/trips/[id]/issues/[issueId]/resolve">) => {
  assertSameOrigin(req);
  const user = await requireRole("LOADER");
  const { id, issueId } = await ctx.params;
  const body = await parseJson(req, loaderResolveIssueSchema);
  const result = await runMutation({
    req,
    actor: user,
    route: `POST /api/loader/trips/${id}/issues/${issueId}/resolve`,
    body,
    requireIdempotencyKey: true,
    fn: (mctx) => resolveIssue(mctx, id, issueId, body),
  });
  return ok(result.data);
});
