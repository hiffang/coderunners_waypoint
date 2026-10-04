import type { Brand, DockType, ParkingConstraint, VehicleStatus, VehicleType } from "./enums";
import type { LocalDate, LocalTime } from "./common";

export type DepotDto = { id: string; name: string };

/** Outlets have no supplied display name; show `outletLabel(o)` (e.g. "OUT001 · Fresh Colombo"). */
export type OutletDto = {
  id: string; // supplied OUT001
  brand: Brand;
  district: string;
  depotId: string;
  depotName: string;
  dockType: DockType;
  parkingConstraint: ParkingConstraint;
  windowOpen: LocalTime;
  windowClose: LocalTime;
  mallWindowOpen: LocalTime | null;
  mallWindowClose: LocalTime | null;
};

export type VehicleDto = {
  id: string; // supplied VEH014
  depotId: string;
  type: VehicleType;
  refrigerated: boolean;
  weightCapKg: number;
  volumeCapM3: number;
  fuelLitersPerKm: number;
  weeklyFuelQuotaLiters: number;
  status: VehicleStatus;
  driver: { id: string; name: string } | null;
};

export type CalendarDayDto = {
  date: LocalDate;
  isOperating: boolean;
  isoYear: number;
  isoWeek: number;
  festival: string | null;
  isHoliday: boolean;
  /** "derived": outside supplied calendar.csv; Mon-Sat fallback rule. */
  source: "supplied" | "derived";
};

/** GET /api/shared/reference: only what the caller's role/scope may see. */
export type ReferenceDto = {
  depots: DepotDto[];
  outlets: OutletDto[];
  vehicles: VehicleDto[];
  calendar: CalendarDayDto[]; // today .. +21 days
  cutoff: {
    localTime: LocalTime; // "16:00"
    earliestEligibleDate: LocalDate; // for an order received now
  };
};

const BRAND_LABEL: Record<Brand, string> = { FRESH: "Fresh", STYLE: "Style", TECH: "Tech" };

export function brandLabel(brand: Brand) {
  return BRAND_LABEL[brand];
}

export function outletLabel(o: { id: string; brand: Brand; district: string }) {
  return `${o.id} · ${BRAND_LABEL[o.brand]} ${o.district}`;
}
