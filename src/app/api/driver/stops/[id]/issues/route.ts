import { assertSameOrigin, handle, ok, parseJson } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { runMutation } from "@/server/mutation";
import { driverIssueSchema } from "@/shared/dto/issue";
import { reportStopIssue } from "@/features/driver/server/actions";

export const dynamic = "force-dynamic";

/** Delay/access/damage/other report from the road. Bumps Stop.version. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/driver/stops/[id]/issues">) => {
  assertSameOrigin(req);
  const user = await requireRole("DRIVER");
  const { id } = await ctx.params;
  const body = await parseJson(req, driverIssueSchema);
  const result = await runMutation({
    req,
    actor: user,
    route: `POST /api/driver/stops/${id}/issues`,
    body,
    requireIdempotencyKey: true,
    fn: (mctx) => reportStopIssue(mctx, id, body),
  });
  return ok(result.data);
});