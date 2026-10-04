import type { Metadata } from "next";
import { DriverShellApp } from "@/features/driver/components/driver-shell";
import { ServiceWorkerRegistration } from "@/lib/offline/service-worker";

export const metadata: Metadata = { title: "Driver (offline)" };

// Static and anonymous on purpose: the service worker caches this HTML and
// serves it for any /driver/... URL when offline. No session, no personal data.
export const dynamic = "force-static";

export default function DriverShellPage() {
  return (
    <>
      <ServiceWorkerRegistration />
      <DriverShellApp />
    </>
  );
}