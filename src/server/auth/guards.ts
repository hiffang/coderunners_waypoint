import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { forbidden, unauthorized } from "@/server/http";
import { ROLE_HOME, type Role } from "@/shared/roles";

export type SessionUser = {
  id: string;
  name?: string | null;
  username: string;
  role: Role;
  depotId: string | null;
  outletId: string | null;
  vehicleId: string | null;
};

/** For pages/layouts: redirect to login or the user's own portal. */
export async function requirePageRole(...roles: Role[]): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (roles.length && !roles.includes(session.user.role)) redirect(ROLE_HOME[session.user.role]);
  return session.user;
}

/** For route handlers: throw 401/403 HttpError. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user) throw unauthorized();
  if (roles.length && !roles.includes(session.user.role)) throw forbidden();
  return session.user;
}

/**
 * Object-level scope checks. Every API that reads or mutates a specific
 * record must call one of these after loading it, not just requireRole.
 */
export function assertOutletScope(user: SessionUser, outletId: string) {
  if (user.role === "DISPATCHER") return;
  if (user.role !== "STORE" || user.outletId !== outletId) throw forbidden("Outlet outside your scope");
}

/**
 * Driver access is decided by the trip's assignment, never by a vehicle or
 * user ID the client submits. Pass `trip.assignedDriverId`.
 */
export function assertDriverScope(user: SessionUser, assignedDriverId: string | null) {
  if (user.role === "DISPATCHER") return;
  if (user.role !== "DRIVER" || !assignedDriverId || assignedDriverId !== user.id) {
    throw forbidden("Trip not assigned to you");
  }
}

/** Every seeded account carries a depot; an account without one sees nothing depot-scoped. */
export function assertDepotScope(user: SessionUser, depotId: string) {
  if (!user.depotId || user.depotId !== depotId) throw forbidden("Depot outside your scope");
}
