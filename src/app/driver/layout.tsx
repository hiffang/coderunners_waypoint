import { PortalShell } from "@/components/shell/portal-shell";
import { requirePageRole } from "@/server/auth/guards";
import { driverNav } from "@/features/driver/nav";

export default async function DriverLayout({ children }: LayoutProps<"/driver">) {
  const user = await requirePageRole("DRIVER");
  return (
    <PortalShell user={user} nav={driverNav}>
      {children}
    </PortalShell>
  );
}
