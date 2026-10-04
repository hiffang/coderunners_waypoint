import { handle, ok, assertSameOrigin, parseJson } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { runMutation } from "@/server/mutation";
export const runtime = "nodejs";
import { versionOnlySchema } from "@/shared/dto/common";
import { publishPlan } from "@/features/dispatcher/server/service";
export const POST = handle(
  async (req, context: { params: Promise<{ id: string }> }) => {
    assertSameOrigin(req);
    const actor = await requireRole("DISPATCHER");
    const { id } = await context.params;
    const body = await parseJson(req, versionOnlySchema);
    const result = await runMutation({
      req,
      actor,
      route: `POST /dispatcher/plans/${id}/publish`,
      body,
      requireIdempotencyKey: true,
      fn: (ctx) => publishPlan(ctx, id, body.expectedVersion),
    });
    return ok(result.data);
  },
);
