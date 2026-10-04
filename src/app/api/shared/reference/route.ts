import type { Prisma } from "@/generated/prisma/client";
import { handle, ok } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { db } from "@/server/db";
import { toNumber } from "@/server/decimal";
import { ORDER_CUTOFF, earliestEligibleDate, loadCalendar } from "@/server/calendar";
import { addDays, localDate, now } from "@/server/time";
import type { ReferenceDto } from "@/shared/dto/reference";

export const dynamic = "force-dynamic";

/**
 * Role-visible master data. Dispatcher/loader: their depot's outlets and fleet.
 * Driver: own vehicle and the depot's outlets. Store: own outlet only, no fleet.
 */
export const GET = handle(async () => {
  const user = await requireRole();
  const depotId = user.depotId ?? "__none__";

  const outletWhere: Prisma.OutletWhereInput =
    user.role === "STORE" ? { id: user.outletId ?? "__none__" } : { depotId };
  const vehicleWhere: Prisma.VehicleWhereInput | null =
    user.role === "STORE" ? null : user.role === "DRIVER" ? { id: user.vehicleId ?? "__none__" } : { depotId };

  const today = localDate(now());
  const [depots, outlets, vehicles, lookup] = await Promise.all([
    db.depot.findMany({ where: { id: depotId }, orderBy: { name: "asc" } }),
    db.outlet.findMany({ where: outletWhere, include: { depot: true }, orderBy: { id: "asc" } }),
    vehicleWhere
      ? db.vehicle.findMany({ where: vehicleWhere, include: { driver: { select: { id: true, displayName: true } } }, orderBy: { id: "asc" } })
      : Promise.resolve([]),
    loadCalendar(today, 30),
  ]);

  const body: ReferenceDto = {
    depots: depots.map((d) => ({ id: d.id, name: d.name })),
    outlets: outlets.map((o) => ({
      id: o.id,
      brand: o.brand,
      district: o.district,
      depotId: o.depotId,
      depotName: o.depot.name,
      dockType: o.dockType,
      parkingConstraint: o.parkingConstraint,
      windowOpen: o.windowOpen,
      windowClose: o.windowClose,
      mallWindowOpen: o.mallWindowOpen,
      mallWindowClose: o.mallWindowClose,
    })),
    vehicles: vehicles.map((v) => ({
      id: v.id,
      depotId: v.depotId,
      type: v.type,
      refrigerated: v.refrigerated,
      weightCapKg: toNumber(v.weightCapKg) ?? 0,
      volumeCapM3: toNumber(v.volumeCapM3) ?? 0,
      fuelLitersPerKm: toNumber(v.fuelLitersPerKm) ?? 0,
      weeklyFuelQuotaLiters: toNumber(v.weeklyFuelQuotaLiters) ?? 0,
      status: v.status,
      driver: v.driver ? { id: v.driver.id, name: v.driver.displayName } : null,
    })),
    calendar: Array.from({ length: 22 }, (_, i) => {
      const d = lookup(addDays(today, i));
      return {
        date: d.date,
        isOperating: d.isOperating,
        isoYear: d.isoYear,
        isoWeek: d.isoWeek,
        festival: d.festival,
        isHoliday: d.isHoliday,
        source: d.source,
      };
    }),
    cutoff: { localTime: ORDER_CUTOFF, earliestEligibleDate: earliestEligibleDate(now(), lookup) },
  };
  return ok(body);
});
