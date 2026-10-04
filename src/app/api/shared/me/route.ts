import { handle, ok } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { db } from "@/server/db";
import { APP_TIMEZONE, isDemoClock, now } from "@/server/time";
import type { MeDto } from "@/shared/dto/me";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const user = await requireRole();
  const depot = user.depotId ? await db.depot.findUnique({ where: { id: user.depotId } }) : null;
  const body: MeDto = {
    id: user.id,
    username: user.username,
    name: user.name ?? user.username,
    role: user.role,
    depotId: user.depotId,
    depotName: depot?.name ?? null,
    outletId: user.outletId,
    vehicleId: user.vehicleId,
    timezone: APP_TIMEZONE,
    serverTime: now().toISOString(),
    demoClock: isDemoClock(),
  };
  return ok(body);
});
