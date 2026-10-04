"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { useOfflineSnapshot, useOutbox } from "@/lib/offline";
import { offlineDb } from "@/lib/offline/db";
import { scopeKey } from "@/lib/offline/types";
import { fetchIssues, fetchManifest, fetchTripList, issuesKey, manifestKey, revokedKey, tripsKey } from "./client-actions";
import { projectManifest, type ProjectedManifest } from "./projection";
import { useLoader } from "./session";
import type { LoaderIssueListDto, LoaderManifestDto, LoaderTripListDto } from "./types";

const REFRESH_MS = 20_000;

/** Trip list: rendered from the stored snapshot (works offline), refreshed in the background when reachable. */
export function useTripList() {
  const { scope } = useLoader();
  const stored = useOfflineSnapshot<LoaderTripListDto>(scope, tripsKey);
  const events = useOutbox(scope);
  const refresh = useQuery({
    queryKey: ["loader", "trips", scopeKey(scope)],
    queryFn: () => fetchTripList(scope),
    refetchInterval: REFRESH_MS,
    retry: false,
  });
  return { stored, events, refresh };
}

/** One manifest: server snapshot + queued local actions, kept apart for labelling. */
export function useManifest(tripId: string) {
  const { scope } = useLoader();
  const stored = useOfflineSnapshot<LoaderManifestDto>(scope, manifestKey(tripId));
  const revoked = useOfflineSnapshot<{ at: string; message: string }>(scope, revokedKey(tripId));
  const events = useOutbox(scope);
  const refresh = useQuery({
    queryKey: ["loader", "manifest", scopeKey(scope), tripId],
    queryFn: () => fetchManifest(scope, tripId),
    refetchInterval: REFRESH_MS,
    retry: false,
  });
  const manifest: ProjectedManifest | null | undefined = useMemo(() => {
    if (stored === undefined || events === undefined) return undefined;
    if (!stored) return null;
    return projectManifest(stored.data, stored.savedAt, events);
  }, [stored, events]);
  // A newer successful fetch clears a stale "no longer visible" marker.
  const isRevoked = !!revoked && (!stored || revoked.savedAt > stored.savedAt);
  return { manifest, savedAt: stored?.savedAt ?? null, refresh, revoked: isRevoked ? revoked!.data : null };
}

export function useIssueList() {
  const { scope } = useLoader();
  const stored = useOfflineSnapshot<LoaderIssueListDto>(scope, issuesKey);
  const refresh = useQuery({
    queryKey: ["loader", "issues", scopeKey(scope)],
    queryFn: () => fetchIssues(scope),
    refetchInterval: REFRESH_MS,
    retry: false,
  });
  return { stored, refresh };
}

/** Every downloaded manifest of this account (sync screen). */
export function useStoredManifests() {
  const { scope } = useLoader();
  const sk = scopeKey(scope);
  return useLiveQuery(
    () =>
      offlineDb()
        .snapshots.where("scopeKey")
        .equals(sk)
        .filter((r) => r.key.startsWith("manifest:"))
        .toArray()
        .then((rows) => rows.map((r) => ({ manifest: r.data as LoaderManifestDto, savedAt: r.savedAt }))),
    [sk],
  );
}
