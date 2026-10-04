import { handle, ok, assertSameOrigin, parseJson } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { runMutation } from "@/server/mutation";
export const runtime = "nodejs";
import { planDecisionsSchema } from "@/shared/dto/plan";
import { saveDecisions } from "@/features/dispatcher/server/service";
export const PUT = handle(
  async (req, context: { params: Promise<{ id: string }> }) => {
    assertSameOrigin(req);
    const actor = await requireRole("DISPATCHER");
    const { id } = await context.params;
    const body = await parseJson(req, planDecisionsSchema);
    const result = await runMutation({
      req,
      actor,
      route: `PUT /dispatcher/plans/${id}/decisions`,
      body,
      requireIdempotencyKey: true,
      fn: (ctx) => saveDecisions(ctx, id, body.expectedVersion, body.decisions),
    });
    return ok(result.data);
  },
);
