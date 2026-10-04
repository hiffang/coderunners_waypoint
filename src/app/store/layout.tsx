import { PortalShell } from "@/components/shell/portal-shell";
import { requirePageRole } from "@/server/auth/guards";
import { storeNav } from "@/features/store/nav";

export default async function StoreLayout({ children }: LayoutProps<"/store">) {
  const user = await requirePageRole("STORE");
  return (
    <PortalShell user={user} nav={storeNav}>
      {children}
    </PortalShell>
  );
}
