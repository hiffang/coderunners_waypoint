import type { NavItem } from "@/components/shell/nav-links";

export const storeNav: NavItem[] = [
  { href: "/store", label: "Orders", exact: true },
  { href: "/store/deliveries", label: "Deliveries" },
  { href: "/store/receipts", label: "Receipts" },
  { href: "/store/issues", label: "Issues" },
];
