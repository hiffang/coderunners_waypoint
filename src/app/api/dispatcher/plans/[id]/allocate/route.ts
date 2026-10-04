// Contract stub (docs/TEAM_CONTRACT.md section 6). Owner replaces with the real handler.
import { handle, notImplemented } from "@/server/http";
import { requireRole } from "@/server/auth/guards";

export const POST = handle(async () => {
  await requireRole("DISPATCHER");
  return notImplemented("POST /api/dispatcher/plans/[id]/allocate");
});
