import type { Metadata } from "next";
import { DriverHome } from "@/features/driver/components/driver-home";

export const metadata: Metadata = { title: "My routes" };

export default function DriverHomePage() {
  return <DriverHome />;
}