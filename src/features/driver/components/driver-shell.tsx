"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CloudOff } from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { LoadingScreen } from "@/components/loading-screen";
import { getActiveAccount, useNavigatorOnline } from "@/lib/offline";
import { DriverLink, DriverSessionProvider, useShellLocation } from "../session";
import { DriverHome } from "./driver-home";
import { StopView } from "./stop-view";
import { SyncView } from "./sync-view";
import { TripView } from "./trip-view";

/**
 * Offline mobile shell. The service worker serves this static page (no
 * cookies, no personal data in the HTML) under the original /driver/... URL
 * when the network is unavailable. Everything personal comes from the
 * IndexedDB partition of the account last verified online on this device.
 */
export function DriverShellApp() {
  const { path, navigate } = useShellLocation();
  const account = useLiveQuery(() => getActiveAccount("DRIVER").catch(() => null), []);
  const session = useSessionCheck(account?.scope.userId ?? null);

  if (path === null || account === undefined) {
    return (
      <ShellFrame>
        <LoadingScreen portal="driver" title="Opening your workspace" />
      </ShellFrame>
    );
  }
  if (!account) {
    return (
      <ShellFrame>
        <div className="mx-auto max-w-xl rounded-2xl border border-dashed bg-card p-6 text-center" data-testid="no-route">
          <CloudOff className="mx-auto size-8 text-muted-foreground" />
          <h1 className="mt-2 font-semibold">No route saved on this phone</h1>
          <p className="mt-1 text-sm text-muted-foreground">Connect to the internet, sign in and download your route before going offline.</p>
          <a href="/driver" className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary text-base font-medium text-primary-foreground">
            Try again
          </a>
        </div>
      </ShellFrame>
    );
  }
  if (session === "other") {
    return (
      <ShellFrame>
        <div className="mx-auto max-w-xl rounded-2xl border bg-card p-6 text-center">
          <h1 className="font-semibold">Another account is signed in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {account.displayName}&apos;s saved route is hidden and their saved work is not sent under this login.
          </p>
          <a href="/driver" className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary text-base font-medium text-primary-foreground">
            Open my routes
          </a>
        </div>
      </ShellFrame>
    );
  }

  const user = { id: account.scope.userId, name: account.displayName, vehicleId: account.scope.scopeId };
  return (
    <DriverSessionProvider user={user} mode="shell" navigate={navigate}>
      <ShellFrame nav>
        <ShellRoute path={path} />
      </ShellFrame>
    </DriverSessionProvider>
  );
}

function ShellRoute({ path }: { path: string }) {
  const trip = /^\/driver\/trips\/([^/]+)\/?$/.exec(path);
  if (trip) return <TripView tripId={decodeURIComponent(trip[1])} />;
  const stop = /^\/driver\/stops\/([^/]+)\/?$/.exec(path);
  if (stop) return <StopView stopId={decodeURIComponent(stop[1])} />;
  if (/^\/driver\/sync\/?$/.test(path)) return <SyncView />;
  return <DriverHome />;
}

function ShellFrame({ nav = false, children }: { nav?: boolean; children: React.ReactNode }) {
  const online = useNavigatorOnline();
  return (
    <div className="flex min-h-svh flex-col" data-testid="driver-shell">
      <header className="sticky top-0 z-30 border-b bg-card">
        <div className="flex h-14 items-center gap-4 px-4">
          <Logo />
          <span className="ml-auto rounded-full bg-warn-soft px-2.5 py-1 text-xs font-semibold text-warn">
            {online ? "Saved copy" : "Offline mode"}
          </span>
        </div>
        {nav && (
          <nav className="flex border-t px-2">
            <DriverLink href="/driver" className="px-3 py-3 text-sm font-medium">
              My route
            </DriverLink>
            <DriverLink href="/driver/sync" className="px-3 py-3 text-sm font-medium">
              Sync
            </DriverLink>
          </nav>
        )}
      </header>
      <main className="flex-1 px-4 py-5">{children}</main>
    </div>
  );
}

/** When reachable, confirm who is signed in so another account never sees this partition. */
function useSessionCheck(userId: string | null) {
  const [state, setState] = useState<"unknown" | "same" | "other" | "none">("unknown");
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    fetch("/api/shared/me", { cache: "no-store" })
      .then(async (res) => {
        if (!alive) return;
        if (res.status === 401) return setState("none");
        const body = (await res.json().catch(() => null)) as { ok: boolean; data?: { id: string } } | null;
        setState(body?.ok && body.data?.id !== userId ? "other" : "same");
      })
      .catch(() => alive && setState("unknown"));
    return () => {
      alive = false;
    };
  }, [userId]);
  return state;
}
