import { handle, ok, assertSameOrigin, parseJson } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { runMutation } from "@/server/mutation";
export const runtime = "nodejs";
import { resolveIssueSchema } from "@/shared/dto/issue";
import { resolveIssue } from "@/features/dispatcher/server/service";
export const POST = handle(
  async (req, context: { params: Promise<{ id: string }> }) => {
    assertSameOrigin(req);
    const actor = await requireRole("DISPATCHER");
    const { id } = await context.params;
    const body = await parseJson(req, resolveIssueSchema);
    const result = await runMutation({
      req,
      actor,
      route: `POST /dispatcher/issues/${id}/resolve`,
      body,
      requireIdempotencyKey: true,
      fn: (ctx) => resolveIssue(ctx, id, body),
    });
    return ok(result.data);
  },
);
