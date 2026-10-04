// Mirrors the Prisma Role enum; safe to import from client components.
export const ROLES = ["DISPATCHER", "LOADER", "DRIVER", "STORE"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_HOME: Record<Role, string> = {
  DISPATCHER: "/dispatcher",
  LOADER: "/loader",
  DRIVER: "/driver",
  STORE: "/store",
};

export const ROLE_LABEL: Record<Role, string> = {
  DISPATCHER: "Dispatcher",
  LOADER: "Loader",
  DRIVER: "Driver",
  STORE: "Store manager",
};
