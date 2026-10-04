import type { Metadata } from "next";
import { SyncView } from "@/features/loader/components/sync-view";

export const metadata: Metadata = { title: "Sync" };

export default function LoaderSyncPage() {
  return <SyncView />;
}
