import { PortalShell } from "@/components/shell/portal-shell";
import { requirePageRole } from "@/server/auth/guards";
import { loaderNav } from "@/features/loader/nav";

export default async function LoaderLayout({ children }: LayoutProps<"/loader">) {
  const user = await requirePageRole("LOADER");
  return (
    <PortalShell user={user} nav={loaderNav}>
      {children}
    </PortalShell>
  );
}
