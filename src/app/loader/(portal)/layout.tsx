import { PortalShell } from "@/components/shell/portal-shell";
import { requirePageRole } from "@/server/auth/guards";
import { loaderNav } from "@/features/loader/nav";
import { LoaderPortalProvider } from "@/features/loader/components/portal-provider";
import { ServiceWorkerRegistration } from "@/lib/offline/service-worker";

/**
 * Online loader portal. Pages are thin: every screen renders from this
 * loader's IndexedDB partition, refreshed from the API, so the offline shell
 * (/loader/shell) shows exactly the same views without a server.
 */
export default async function LoaderLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageRole("LOADER");
  return (
    <PortalShell user={user} nav={loaderNav}>
      {/* Lead: move into the root layout once one shared registration exists. */}
      <ServiceWorkerRegistration />
      <LoaderPortalProvider user={{ id: user.id, name: user.name ?? user.username, depotId: user.depotId }}>{children}</LoaderPortalProvider>
    </PortalShell>
  );
}
