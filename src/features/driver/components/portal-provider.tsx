"use client";

import { DriverSessionProvider, type DriverIdentity } from "../session";

/** Online portal: identity comes from the verified server session. */
export function DriverPortalProvider({ user, children }: { user: DriverIdentity; children: React.ReactNode }) {
  return (
    <DriverSessionProvider user={user} mode="portal">
      {children}
    </DriverSessionProvider>
  );
}
