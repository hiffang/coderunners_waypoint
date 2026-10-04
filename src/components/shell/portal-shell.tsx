import { Logo } from "@/components/shell/logo";
import { NavLinks, type NavItem } from "@/components/shell/nav-links";
import { UserMenu } from "@/components/shell/user-menu";
import { ROLE_LABEL } from "@/shared/roles";
import type { SessionUser } from "@/server/auth/guards";

/**
 * Shared top-bar shell for all four portals. Desktop shows inline tabs;
 * phones get a horizontally scrollable tab row under the header.
 * Portal-specific chrome (e.g. the dispatcher timeline strip) goes in `subheader`.
 */
export function PortalShell({
  user,
  nav,
  actions,
  subheader,
  children,
}: {
  user: SessionUser;
  nav: NavItem[];
  actions?: React.ReactNode;
  subheader?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-30 border-b bg-card">
        <div className="flex h-14 items-center gap-6 px-4 md:px-6">
          <Logo />
          <NavLinks items={nav} className="hidden md:flex" />
          <div className="ml-auto flex items-center gap-3">
            {actions}
            <UserMenu name={user.name ?? user.username} roleLabel={ROLE_LABEL[user.role]} />
          </div>
        </div>
        <NavLinks items={nav} className="flex overflow-x-auto border-t px-2 md:hidden" />
        {subheader}
      </header>
      <main className="flex-1 px-4 py-5 md:px-6">{children}</main>
    </div>
  );
}
