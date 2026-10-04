import { handle, ok, assertSameOrigin, parseJson } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { runMutation } from "@/server/mutation";
export const runtime = "nodejs";
import { deferOrderSchema } from "@/shared/dto/order";
import { deferFailed } from "@/features/dispatcher/server/service";
export const POST = handle(
  async (req, context: { params: Promise<{ id: string }> }) => {
    assertSameOrigin(req);
    const actor = await requireRole("DISPATCHER");
    const { id } = await context.params;
    const body = await parseJson(req, deferOrderSchema);
    const result = await runMutation({
      req,
      actor,
      route: `POST /dispatcher/orders/${id}/defer`,
      body,
      requireIdempotencyKey: true,
      fn: (ctx) => deferFailed(ctx, id, body),
    });
    return ok(result.data);
  },
);
