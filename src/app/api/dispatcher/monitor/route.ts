import { handle, ok, parseQuery } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { listQuerySchema } from "@/shared/dto/common";
import { localDate } from "@/server/time";
import { monitor } from "@/features/dispatcher/server/service";
export const runtime = "nodejs";
export const GET = handle(async (req) => {
  const query = parseQuery(req, listQuerySchema);
  return ok(
    await monitor(
      await requireRole("DISPATCHER"),
      query.serviceDate ?? localDate(),
    ),
  );
});
