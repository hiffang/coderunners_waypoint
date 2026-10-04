// Contract stub (docs/TEAM_CONTRACT.md section 6). Owner replaces with the real handler.
import { handle, notImplemented } from "@/server/http";
import { requireRole } from "@/server/auth/guards";

export const GET = handle(async () => {
  await requireRole("STORE");
  return notImplemented("GET /api/store/orders/[id]");
});

export const PATCH = handle(async () => {
  await requireRole("STORE");
  return notImplemented("PATCH /api/store/orders/[id]");
});
