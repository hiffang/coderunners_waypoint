import { PortalShell } from "@/components/shell/portal-shell";
import { requirePageRole } from "@/server/auth/guards";
import { dispatcherNav } from "@/features/dispatcher/nav";

export default async function DispatcherLayout({
  children,
}: LayoutProps<"/dispatcher">) {
  const user = await requirePageRole("DISPATCHER");
  return (
    <div className="[&_header_nav]:min-w-0 [&_header_nav]:overflow-x-auto">
      <PortalShell user={user} nav={dispatcherNav}>
        {children}
      </PortalShell>
    </div>
  );
}
