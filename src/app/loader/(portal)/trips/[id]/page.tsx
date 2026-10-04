import type { Metadata } from "next";
import { TripView } from "@/features/loader/components/trip-view";

export const metadata: Metadata = { title: "Manifest" };

export default async function LoaderTripPage({ params }: PageProps<"/loader/trips/[id]">) {
  const { id } = await params;
  return <TripView tripId={id} />;
}
