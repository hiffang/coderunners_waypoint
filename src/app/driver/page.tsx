import type { Metadata } from "next";
import { NotBuilt } from "@/components/not-built";

export const metadata: Metadata = { title: "Driver" };

export default function DriverHome() {
  return <NotBuilt portal="Driver" owner="see src/app/driver/CLAUDE.md" />;
}
