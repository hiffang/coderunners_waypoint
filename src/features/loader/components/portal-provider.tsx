"use client";

import { LoaderSessionProvider, type LoaderIdentity } from "../session";

/** Online portal: identity comes from the verified server session. */
export function LoaderPortalProvider({ user, children }: { user: LoaderIdentity; children: React.ReactNode }) {
  return (
    <LoaderSessionProvider user={user} mode="portal">
      {children}
    </LoaderSessionProvider>
  );
}
