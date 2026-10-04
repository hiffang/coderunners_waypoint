"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type NavItem = { href: string; label: string; badge?: number; exact?: boolean };

export function NavLinks({ items, className }: { items: NavItem[]; className?: string }) {
  const pathname = usePathname();
  return (
    <nav className={cn("h-full items-stretch gap-1", className)}>
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground",
              active && "border-ink font-semibold text-foreground",
            )}
          >
            {item.label}
            {item.badge ? (
              <span className="grid size-5 place-items-center rounded-full bg-late text-[11px] font-semibold text-white">
                {item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
