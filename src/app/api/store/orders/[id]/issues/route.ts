import { requireRole } from "@/server/auth/guards";
import { assertSameOrigin, handle, ok, parseJson } from "@/server/http";
import { runMutation } from "@/server/mutation";
import { storeIssueSchema } from "@/shared/dto/issue";
import { reportIssue, readOrder } from "@/features/store/server/service";
export const dynamic = "force-dynamic";
export const GET = handle(
  async (_req: Request, ctx: RouteContext<"/api/store/orders/[id]/issues">) => {
    const actor = await requireRole("STORE");
    return ok((await readOrder(actor, (await ctx.params).id)).issues);
  },
);
export const POST = handle(
  async (req: Request, ctx: RouteContext<"/api/store/orders/[id]/issues">) => {
    assertSameOrigin(req);
    const actor = await requireRole("STORE");
    const { id } = await ctx.params;
    const body = await parseJson(req, storeIssueSchema);
    const result = await runMutation({
      req,
      actor,
      route: `POST /api/store/orders/${id}/issues`,
      body,
      requireIdempotencyKey: true,
      fn: (ctx) => reportIssue(ctx, id, body),
    });
    return ok(result.data);
  },
);
