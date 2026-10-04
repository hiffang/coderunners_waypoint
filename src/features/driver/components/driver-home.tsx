"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronRight, Download, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingScreen } from "@/components/loading-screen";
import { OfflineStorageError, useNavigatorOnline, useOutbox } from "@/lib/offline";
import { ApiClientError } from "@/shared/api";
import { brandLabel } from "@/shared/dto/reference";
import { downloadForOffline } from "../client-actions";
import { ago, clock, dayLabel } from "../format";
import { useTripList } from "../hooks";
import { DriverLink, useDriver } from "../session";
import { bigButton, StateBadge } from "./bits";
import { StatusStrip } from "./status-strip";
import { NoRouteDownloaded, RefreshError } from "./states";

export function DriverHome() {
  const { scope, displayName, vehicleId, mode } = useDriver();
  const { stored, refresh } = useTripList();
  const events = useOutbox(scope);
  const online = useNavigatorOnline();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const r = await downloadForOffline(scope);
      if (r.shell.ok) {
        toast.success(`${r.trips} route${r.trips === 1 ? "" : "s"} and the app saved for offline use`);
      } else {
        toast.warning(`${r.trips} route${r.trips === 1 ? "" : "s"} saved. App shell not cached: ${r.shell.error ?? "unknown error"}`);
      }
    } catch (err) {
      const msg =
        err instanceof OfflineStorageError
          ? err.message
          : err instanceof ApiClientError
            ? err.message
            : "Could not reach the server. Try again when connected.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  const pendingFor = (tripId: string) =>
    (events ?? []).filter((e) => e.meta.tripId === tripId && e.status !== "acknowledged").length;

  return (
    <div className="mx-auto max-w-xl">
      <StatusStrip />
      <header className="mb-4">
        <p className="text-sm text-muted-foreground">{displayName}</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          My routes{vehicleId && <span className="ml-2 font-id text-base text-muted-foreground">{vehicleId}</span>}
        </h1>
      </header>

      {(mode === "portal" || online) && (
        <div className="mb-4 rounded-2xl border bg-card p-4">
          <Button className={bigButton} onClick={download} disabled={busy} data-testid="download-offline">
            <Download className="size-5" />
            {busy ? "Downloading…" : "Download for offline"}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            {stored ? `Routes on this phone saved ${ago(stored.savedAt)} (${clock(stored.savedAt)}).` : "Nothing saved on this phone yet."} Do this
            at the depot before you leave.
          </p>
        </div>
      )}

      <RefreshError error={refresh.error} />

      {stored === undefined ? (
        <LoadingScreen portal="driver" title="Loading your routes" />
      ) : !stored ? (
        refresh.isFetching ? <LoadingScreen portal="driver" title="Loading your routes" /> : <NoRouteDownloaded />
      ) : stored.data.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          No routes are assigned to you in a published plan.
        </div>
      ) : (
        <ul className="space-y-3">
          {stored.data.items.map((t) => {
            const pending = pendingFor(t.id);
            return (
              <li key={t.id}>
                <DriverLink
                  href={`/driver/trips/${t.id}`}
                  className="block rounded-2xl border bg-card p-4 transition-colors hover:border-ink/40"
                  data-testid="trip-card"
                >
                  <div className="flex items-start gap-3">
                    <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary">
                      <Truck className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">
                          {dayLabel(t.serviceDate)} · Trip {t.tripNumber}
                        </span>
                        <StateBadge state={t.state} kind="trip" />
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        <span className="font-id">{t.vehicleId}</span> · {brandLabel(t.brand)} {t.district} · {t.stopCount} stop
                        {t.stopCount === 1 ? "" : "s"}
                      </p>
                      <p className="mt-1 text-sm">
                        Depart <span className="font-id">{clock(t.plannedDepartureAt)}</span> · back{" "}
                        <span className="font-id">{clock(t.plannedReturnAt)}</span>
                      </p>
                      {t.state !== "IN_TRANSIT" && t.state !== "COMPLETED" && (
                        <p className={`mt-1 text-sm ${t.departure.canDepart ? "text-fresh" : "text-warn"}`}>
                          {t.departure.canDepart ? "Released by warehouse: ready to depart" : t.departure.blockers[0]}
                        </p>
                      )}
                      {t.state === "IN_TRANSIT" && (
                        <p className="mt-1 text-sm">
                          {t.terminalStops}/{t.stopCount} stops done (confirmed)
                        </p>
                      )}
                      {pending > 0 && (
                        <p className="mt-1 text-sm font-medium text-warn">
                          {pending} action{pending === 1 ? "" : "s"} saved on phone, not sent yet
                        </p>
                      )}
                    </div>
                    <ChevronRight className="mt-3 size-5 text-muted-foreground" />
                  </div>
                </DriverLink>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
