import type { Metadata } from "next";
import { SyncView } from "@/features/driver/components/sync-view";

export const metadata: Metadata = { title: "Sync" };

export default function DriverSyncPage() {
  return <SyncView />;
}