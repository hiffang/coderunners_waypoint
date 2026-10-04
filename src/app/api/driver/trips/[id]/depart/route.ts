// Contract stub (docs/TEAM_CONTRACT.md section 6). Owner replaces with the real handler.
import { handle, notImplemented } from "@/server/http";
import { requireRole } from "@/server/auth/guards";

export const POST = handle(async () => {
  await requireRole("DRIVER");
  return notImplemented("POST /api/driver/trips/[id]/depart");
});
