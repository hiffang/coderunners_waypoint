// Contract stub (docs/TEAM_CONTRACT.md section 6). Owner replaces with the real handler.
import { handle, notImplemented } from "@/server/http";
import { requireRole } from "@/server/auth/guards";

export const GET = handle(async () => {
  await requireRole("STORE");
  return notImplemented("GET /api/store/orders");
});

export const POST = handle(async () => {
  await requireRole("STORE");
  return notImplemented("POST /api/store/orders");
});
