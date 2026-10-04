import { requireRole } from "@/server/auth/guards";
import { assertSameOrigin, handle, ok, parseJson } from "@/server/http";
import { runMutation } from "@/server/mutation";
import { updateOrderSchema } from "@/shared/dto/order";
import {
  calendarFor,
  readOrder,
  updateOrder,
} from "@/features/store/server/service";
export const dynamic = "force-dynamic";
export const GET = handle(
  async (_req: Request, ctx: RouteContext<"/api/store/orders/[id]">) => {
    const actor = await requireRole("STORE");
    return ok(await readOrder(actor, (await ctx.params).id));
  },
);
export const PATCH = handle(
  async (req: Request, ctx: RouteContext<"/api/store/orders/[id]">) => {
    assertSameOrigin(req);
    const actor = await requireRole("STORE");
    const { id } = await ctx.params;
    const body = await parseJson(req, updateOrderSchema);
    const current = await readOrder(actor, id);
    const lookup = await calendarFor(
      body.requestedDate ?? current.order.eligibleServiceDate,
    );
    const result = await runMutation({
      req,
      actor,
      route: `PATCH /api/store/orders/${id}`,
      body,
      requireIdempotencyKey: true,
      fn: (ctx) => updateOrder(ctx, id, body, lookup),
    });
    return ok(result.data);
  },
);
