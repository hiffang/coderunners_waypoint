import { handle, ok } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { db } from "@/server/db";
import { planDetail } from "@/features/dispatcher/server/service";
export const runtime = "nodejs";
export const GET = handle(
  async (_req, context: { params: Promise<{ id: string }> }) =>
    ok(
      await planDetail(
        db,
        await requireRole("DISPATCHER"),
        (await context.params).id,
      ),
    ),
);
