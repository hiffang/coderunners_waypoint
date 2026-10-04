"use client";

import { CloudOff, KeyRound, PackageX, ShieldAlert } from "lucide-react";
import { ApiClientError } from "@/shared/api";
import { useLoader } from "../session";

/** Degradation: this manifest was never downloaded on this device. A recovery screen, not an empty success. */
export function NoManifestDownloaded({ online }: { online: boolean }) {
  const { mode } = useLoader();
  return (
    <div className="rounded-2xl border border-dashed bg-card p-6 text-center" data-testid="no-manifest">
      <PackageX className="mx-auto size-8 text-muted-foreground" />
      <h2 className="mt-2 font-semibold">No manifest saved on this device</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {mode === "shell" || !online
          ? "You are offline and this manifest was not downloaded. Reconnect, open Manifests and tap “Download for offline” before loading."
          : "Fetching the manifest from the server…"}
      </p>
    </div>
  );
}

/**
 * Background refresh failed. The stored copy stays on screen; this says why it
 * may be stale and what to do. Network errors are expected offline and stay quiet.
 */
export function RefreshError({ error }: { error: unknown }) {
  if (!error) return null;
  if (error instanceof ApiClientError && error.status === 401) {
    return (
      <div className="mb-4 flex gap-3 rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-warn" />
        <div>
          Your session expired. Saved work stays on this device.{" "}
          <a className="font-semibold underline" href={`/login?callbackUrl=${encodeURIComponent(currentPath())}`}>
            Sign in again
          </a>{" "}
          with the same account to send it.
        </div>
      </div>
    );
  }
  if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) {
    return (
      <div className="mb-4 flex gap-3 rounded-xl border border-late/30 bg-late-soft p-3 text-sm text-late">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <div>{error.message}</div>
      </div>
    );
  }
  return (
    <div className="mb-4 flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs text-muted-foreground">
      <CloudOff className="size-3.5" /> Server not reachable · showing the copy saved on this device
    </div>
  );
}

export function RevokedBanner({ message }: { message: string }) {
  return (
    <div className="mb-4 flex gap-3 rounded-xl border border-late/30 bg-late-soft p-3 text-sm text-late" data-testid="revoked">
      <ShieldAlert className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-semibold">This manifest is no longer available to your depot</p>
        <p>{message}. The copy below is what was downloaded earlier. The server will not accept work saved for it; review it on Sync.</p>
      </div>
    </div>
  );
}

function currentPath() {
  return typeof window === "undefined" ? "/loader" : window.location.pathname;
}
