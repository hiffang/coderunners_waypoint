import { handle, ok, assertSameOrigin, parseJson } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { db } from "@/server/db";
import { versionOnlySchema } from "@/shared/dto/common";
import { validateStored } from "@/features/dispatcher/server/service";
export const runtime = "nodejs";
export const POST = handle(
  async (req, context: { params: Promise<{ id: string }> }) => {
    assertSameOrigin(req);
    const actor = await requireRole("DISPATCHER");
    const body = await parseJson(req, versionOnlySchema);
    const { id } = await context.params;
    return ok(
      await db.$transaction(
        (tx) => validateStored(tx, actor, id, body.expectedVersion),
        { isolationLevel: "RepeatableRead" },
      ),
    );
  },
);
