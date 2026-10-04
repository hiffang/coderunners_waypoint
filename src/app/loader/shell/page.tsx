import type { Metadata } from "next";
import { LoaderShellApp } from "@/features/loader/components/loader-shell";
import { ServiceWorkerRegistration } from "@/lib/offline/service-worker";

export const metadata: Metadata = { title: "Loader (offline)" };

// Static and anonymous on purpose: the service worker caches this HTML and
// serves it for any /loader/... URL when offline. No session, no personal data.
export const dynamic = "force-static";

export default function LoaderShellPage() {
  return (
    <>
      <ServiceWorkerRegistration />
      <LoaderShellApp />
    </>
  );
}
