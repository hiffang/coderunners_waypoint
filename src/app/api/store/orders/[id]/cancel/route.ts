import { requireRole } from "@/server/auth/guards";
import { assertSameOrigin, handle, ok, parseJson } from "@/server/http";
import { runMutation } from "@/server/mutation";
import { cancelOrderSchema } from "@/shared/dto/order";
import {
  cancelOrder,
  calendarFor,
  readOrder,
} from "@/features/store/server/service";
export const dynamic = "force-dynamic";
export const POST = handle(
  async (req: Request, ctx: RouteContext<"/api/store/orders/[id]/cancel">) => {
    assertSameOrigin(req);
    const actor = await requireRole("STORE");
    const { id } = await ctx.params;
    const body = await parseJson(req, cancelOrderSchema);
    const current = await readOrder(actor, id);
    const lookup = await calendarFor(current.order.eligibleServiceDate);
    const result = await runMutation({
      req,
      actor,
      route: `POST /api/store/orders/${id}/cancel`,
      body,
      requireIdempotencyKey: true,
      fn: (ctx) => cancelOrder(ctx, id, body, lookup),
    });
    return ok(result.data);
  },
);
