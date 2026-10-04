"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { useOfflineSnapshot, useOutbox } from "@/lib/offline";
import { offlineDb } from "@/lib/offline/db";
import { scopeKey } from "@/lib/offline/types";
import { fetchTrip, fetchTripList, revokedKey, tripKey, tripsKey } from "./client-actions";
import { projectTrip, type ProjectedTrip } from "./projection";
import { useDriver } from "./session";
import type { DriverTripListDto, DriverTripSnapshotDto } from "./types";

const REFRESH_MS = 30_000;

/**
 * Trip list: rendered from the stored snapshot (works offline), refreshed from
 * the server in the background when reachable.
 */
export function useTripList() {
  const { scope } = useDriver();
  const stored = useOfflineSnapshot<DriverTripListDto>(scope, tripsKey);
  const refresh = useQuery({
    queryKey: ["driver", "trips", scopeKey(scope)],
    queryFn: () => fetchTripList(scope),
    refetchInterval: REFRESH_MS,
    retry: false,
  });
  return { stored, refresh };
}

/** One trip: server snapshot + queued local actions, kept apart for labelling. */
export function useTrip(tripId: string | null) {
  const { scope } = useDriver();
  const stored = useOfflineSnapshot<DriverTripSnapshotDto>(scope, tripId ? tripKey(tripId) : "");
  const revoked = useOfflineSnapshot<{ at: string; message: string }>(scope, tripId ? revokedKey(tripId) : "");
  const events = useOutbox(scope);
  const refresh = useQuery({
    queryKey: ["driver", "trip", scopeKey(scope), tripId],
    queryFn: () => fetchTrip(scope, tripId!),
    enabled: !!tripId,
    refetchInterval: REFRESH_MS,
    retry: false,
  });
  const trip: ProjectedTrip | null | undefined = useMemo(() => {
    if (stored === undefined || events === undefined) return undefined;
    if (!stored) return null;
    return projectTrip(stored.data, stored.savedAt, events);
  }, [stored, events]);
  // A newer successful fetch clears a stale "reassigned" marker.
  const isRevoked = !!revoked && (!stored || revoked.savedAt > stored.savedAt);
  return { trip, savedAt: stored?.savedAt ?? null, refresh, revoked: isRevoked ? revoked!.data : null };
}

/** Find which downloaded trip holds `stopId` (stop pages have no trip id in the URL). */
export function useTripIdForStop(stopId: string) {
  const { scope } = useDriver();
  const sk = scopeKey(scope);
  return useLiveQuery(async () => {
    const rows = await offlineDb()
      .snapshots.where("scopeKey")
      .equals(sk)
      .filter((r) => r.key.startsWith("trip:"))
      .toArray();
    const hit = rows.find((r) => (r.data as DriverTripSnapshotDto).stops.some((s) => s.stopId === stopId));
    return hit ? (hit.data as DriverTripSnapshotDto).id : null;
  }, [sk, stopId]);
}

/** Every downloaded trip snapshot of this account (sync screen). */
export function useStoredTrips() {
  const { scope } = useDriver();
  const sk = scopeKey(scope);
  return useLiveQuery(
    () =>
      offlineDb()
        .snapshots.where("scopeKey")
        .equals(sk)
        .filter((r) => r.key.startsWith("trip:"))
        .toArray()
        .then((rows) => rows.map((r) => ({ snapshot: r.data as DriverTripSnapshotDto, savedAt: r.savedAt }))),
    [sk],
  );
}
