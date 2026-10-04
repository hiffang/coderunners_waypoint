import type { Metadata } from "next";
import { TripView } from "@/features/driver/components/trip-view";

export const metadata: Metadata = { title: "Trip" };

export default async function DriverTripPage({ params }: PageProps<"/driver/trips/[id]">) {
  const { id } = await params;
  return <TripView tripId={id} />;
}