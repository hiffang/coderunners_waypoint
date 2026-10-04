import { requireRole } from "@/server/auth/guards";
import { assertSameOrigin, handle, ok, parseJson } from "@/server/http";
import { runMutation } from "@/server/mutation";
import { receiptSchema } from "@/shared/dto/order";
import { receiveOrder } from "@/features/store/server/service";
export const dynamic = "force-dynamic";
export const POST = handle(
  async (req: Request, ctx: RouteContext<"/api/store/orders/[id]/receipt">) => {
    assertSameOrigin(req);
    const actor = await requireRole("STORE");
    const { id } = await ctx.params;
    const body = await parseJson(req, receiptSchema);
    const result = await runMutation({
      req,
      actor,
      route: `POST /api/store/orders/${id}/receipt`,
      body,
      requireIdempotencyKey: true,
      fn: (ctx) => receiveOrder(ctx, id, body),
    });
    return ok(result.data);
  },
);
