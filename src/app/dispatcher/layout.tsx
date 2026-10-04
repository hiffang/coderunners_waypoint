import { PortalShell } from "@/components/shell/portal-shell";
import { requirePageRole } from "@/server/auth/guards";
import { dispatcherNav } from "@/features/dispatcher/nav";

export default async function DispatcherLayout({ children }: LayoutProps<"/dispatcher">) {
  const user = await requirePageRole("DISPATCHER");
  return (
    <PortalShell user={user} nav={dispatcherNav}>
      {children}
    </PortalShell>
  );
}
