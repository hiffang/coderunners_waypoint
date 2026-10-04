import { PortalShell } from "@/components/shell/portal-shell";
import { requirePageRole } from "@/server/auth/guards";
import { driverNav } from "@/features/driver/nav";
import { DriverPortalProvider } from "@/features/driver/components/portal-provider";
import { ServiceWorkerRegistration } from "@/lib/offline/service-worker";

/**
 * Online driver portal. Pages are thin: every screen renders from this
 * driver's IndexedDB partition, refreshed from the API, so the offline shell
 * (/driver/shell) shows exactly the same views without a server.
 */
export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageRole("DRIVER");
  return (
    <PortalShell user={user} nav={driverNav}>
      {/* Lead: move into the root layout once loader/store need the worker too (one shared registration). */}
      <ServiceWorkerRegistration />
      <DriverPortalProvider user={{ id: user.id, name: user.name ?? user.username, vehicleId: user.vehicleId }}>{children}</DriverPortalProvider>
    </PortalShell>
  );
}