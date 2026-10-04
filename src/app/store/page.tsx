import type { Metadata } from "next";
import { NotBuilt } from "@/components/not-built";

export const metadata: Metadata = { title: "Store" };

export default function StoreHome() {
  return <NotBuilt portal="Store" owner="see src/app/store/CLAUDE.md" />;
}
