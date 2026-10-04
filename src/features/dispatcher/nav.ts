import type { NavItem } from "@/components/shell/nav-links";

export const dispatcherNav: NavItem[] = [
  { href: "/dispatcher", label: "Overview", exact: true },
  { href: "/dispatcher/routes", label: "Routes" },
  { href: "/dispatcher/loading-bays", label: "Loading bays" },
  { href: "/dispatcher/orders", label: "Orders" },
  { href: "/dispatcher/deferrals", label: "Deferrals" },
  { href: "/dispatcher/monitor", label: "Monitor" },
  { href: "/dispatcher/reports", label: "Reports" },
];
