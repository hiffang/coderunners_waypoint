"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { rememberAccount, subscribe, useAutoSync, type OfflineScope } from "@/lib/offline";
import { scopeKey } from "@/lib/offline/types";

export type LoaderIdentity = { id: string; name: string; depotId: string | null };

type Session = {
  scope: OfflineScope;
  displayName: string;
  /** portal: server-rendered pages (online). shell: offline shell served by the service worker. */
  mode: "portal" | "shell";
  navigate: (href: string) => void;
  syncNow: () => Promise<unknown>;
};

const Ctx = createContext<Session | null>(null);

export function useLoader(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useLoader outside LoaderSessionProvider");
  return s;
}

/** One offline partition per loader account and depot. */
export function loaderScope(user: Pick<LoaderIdentity, "id" | "depotId">): OfflineScope {
  return { userId: user.id, role: "LOADER", scopeId: user.depotId ?? "no-depot" };
}

export function LoaderSessionProvider({
  user,
  mode,
  navigate,
  children,
}: {
  user: LoaderIdentity;
  mode: Session["mode"];
  navigate?: (href: string) => void;
  children: React.ReactNode;
}) {
  const { id, depotId } = user;
  const scope = useMemo(() => loaderScope({ id, depotId }), [id, depotId]);
  const qc = useQueryClient();
  const { syncNow } = useAutoSync(scope);

  // Only a server-verified session (portal mode) may mark this account as the device's active one.
  useEffect(() => {
    if (mode === "portal") void rememberAccount(scope, user.name).catch(() => {});
  }, [mode, scope, user.name]);

  // Acknowledged writes change server state: refresh the cached manifests.
  useEffect(
    () =>
      subscribe((s) => {
        if (s.scopeKey === scopeKey(scope) && (s.type === "sync-end" || s.type === "acknowledged")) {
          void qc.invalidateQueries({ queryKey: ["loader"] });
        }
      }),
    [qc, scope],
  );

  const value = useMemo<Session>(
    () => ({ scope, displayName: user.name, mode, navigate: navigate ?? (() => {}), syncNow }),
    [scope, user.name, mode, navigate, syncNow],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Link that works in both modes: Next navigation in the portal, history navigation inside the offline shell. */
export function LoaderLink({
  href,
  className,
  children,
  ...rest
}: { href: string; className?: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const { mode, navigate } = useLoader();
  if (mode === "portal") {
    return (
      <Link href={href} className={className} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

/** Pathname state for the offline shell (no server round trip for navigation). */
export function useShellLocation() {
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const navigate = (href: string) => {
    window.history.pushState(null, "", href);
    setPath(new URL(href, window.location.href).pathname);
    window.scrollTo(0, 0);
  };
  return { path, navigate };
}
