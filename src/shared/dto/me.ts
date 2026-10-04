import type { Role } from "@/shared/roles";

/** GET /api/shared/me (alias /api/me). Scope is derived server-side from the account. */
export type MeDto = {
  id: string;
  username: string;
  name: string;
  role: Role;
  depotId: string | null;
  depotName: string | null;
  outletId: string | null;
  vehicleId: string | null;
  timezone: string;
  serverTime: string; // ISO, honours DEMO_CLOCK
  demoClock: boolean;
};
