import type { Metadata } from "next";
import { StopView } from "@/features/driver/components/stop-view";

export const metadata: Metadata = { title: "Stop" };

export default async function DriverStopPage({ params }: PageProps<"/driver/stops/[id]">) {
  const { id } = await params;
  return <StopView stopId={id} />;
}