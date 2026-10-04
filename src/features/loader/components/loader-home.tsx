"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronRight, Download, Snowflake, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigatorOnline } from "@/lib/offline";
import { cn } from "@/lib/utils";
import { brandLabel } from "@/shared/dto/reference";
import { downloadForOffline } from "../client-actions";
import { ago, clock, dayLabel, plural } from "../format";
import { useTripList } from "../hooks";
import { LOADER_KINDS } from "../projection";
import { LoaderLink, useLoader } from "../session";
import type { LoaderTripListItemDto } from "../types";
import { bigButton, StateBadge } from "./bits";
import { RefreshError } from "./states";
import { StatusStrip } from "./status-strip";

/** /loader: this depot's published trips with loading progress and release status. */
export function LoaderHome() {
  const { scope, mode } = useLoader();
  const { stored, events, refresh } = useTripList();
  const online = useNavigatorOnline();
  const [downloading, setDownloading] = useState(false);

  async function download() {
    setDownloading(true);
    try {
      const r = await downloadForOffline(scope);
      const shell = r.shell.ok && r.shell.shells.includes("/loader/shell") ? "offline reload ready" : (r.shell.error ?? "offline reload not available");
      toast.success(`${plural(r.trips, "manifest")} saved on this device · ${shell}`);
    } catch {
      toast.error("Download failed. Connect to the network and try again.");
    } finally {
      setDownloading(false);
    }
  }

  const queuedByTrip = new Map<string, number>();
  for (const e of events ?? []) {
    if (e.status === "acknowledged" || !(LOADER_KINDS as readonly string[]).includes(e.kind)) continue;
    const id = e.meta.tripId as string;
    queuedByTrip.set(id, (queuedByTrip.get(id) ?? 0) + 1);
  }

  const items = stored?.data.items ?? [];
  const byDate = new Map<string, LoaderTripListItemDto[]>();
  for (const t of items) byDate.set(t.serviceDate, [...(byDate.get(t.serviceDate) ?? []), t]);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Manifests</h1>
          <p className="text-sm text-muted-foreground">
            Published trips for your depot · {stored ? `updated ${ago(stored.savedAt)}` : "not downloaded yet"}
          </p>
        </div>
        {mode === "portal" && (
          <Button variant="outline" className="h-11 rounded-xl" onClick={download} disabled={downloading || !online} data-testid="download-offline">
            <Download className="size-4" /> {downloading ? "Downloading…" : "Download for offline"}
          </Button>
        )}
      </header>

      <StatusStrip />
      <RefreshError error={refresh.error} />

      {stored === undefined || (stored === null && refresh.isPending) ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-6 text-center" data-testid="no-trips">
          <Truck className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-2 font-semibold">{stored ? "No published trips to load" : "No manifests on this device"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {stored
              ? "Trips appear here once the dispatcher publishes a plan for your depot."
              : "Connect to the network to see your depot's published trips."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {[...byDate.entries()].map(([date, trips]) => (
            <section key={date}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Service date {dayLabel(date)}</h2>
              <ul className="space-y-3" data-testid="trip-list">
                {trips.map((t) => (
                  <TripCard key={t.id} trip={t} queued={queuedByTrip.get(t.id) ?? 0} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {mode === "portal" && items.length > 0 && (
        <p className="mt-6 text-xs text-muted-foreground">
          Tip: download before working in a cold room or dock with poor signal. Checks and issue reports are saved on this device and sent
          automatically; releasing a trip needs a connection.
        </p>
      )}
      {mode === "shell" && (
        <a href="/loader" className={cn(bigButton, "mt-6 inline-flex items-center justify-center border bg-card text-sm font-medium")}>
          Reconnect and open the live portal
        </a>
      )}
    </div>
  );
}

function TripCard({ trip: t, queued }: { trip: LoaderTripListItemDto; queued: number }) {
  const r = t.readiness;
  const pct = r.totalLines ? Math.round((r.checkedLines / r.totalLines) * 100) : 0;
  return (
    <li>
      <LoaderLink
        href={`/loader/trips/${t.id}`}
        className="block rounded-2xl border bg-card p-4 transition-colors hover:border-ink/40"
        data-testid="trip-card"
        data-trip-id={t.id}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-id text-lg font-semibold">{t.vehicleId}</span>
              <span className="text-sm text-muted-foreground">
                {t.vehicleType === "TRUCK" ? "Truck" : "Van"}
                {t.refrigerated && (
                  <span className="ml-1 inline-flex items-center gap-0.5 text-chilled">
                    <Snowflake className="size-3.5" /> reefer
                  </span>
                )}
              </span>
              <StateBadge state={t.state} />
            </div>
            <p className="mt-1 text-sm">
              Trip {t.tripNumber} · {brandLabel(t.brand)} · {t.district} · {plural(t.stopCount, "stop")}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-id text-lg font-semibold">{clock(t.plannedDepartureAt)}</p>
            <p className="text-xs text-muted-foreground">departs</p>
          </div>
        </div>

        <div className="mt-3">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {r.checkedLines}/{r.totalLines} lines checked
            </span>
            <span>
              plan rev <span className="font-id">{t.planRevision}</span>
              {t.planPublishedAt ? ` · published ${ago(t.planPublishedAt)}` : ""}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary" aria-hidden>
            <div className={cn("h-full rounded-full", r.canRelease || t.state === "READY" ? "bg-lime" : "bg-ink")} style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {t.openBlockingIssues > 0 && (
            <span className="rounded-full bg-late-soft px-2 py-0.5 font-semibold text-late" data-testid="blocking-count">
              {plural(t.openBlockingIssues, "blocking issue")}
            </span>
          )}
          {r.shortLines + r.damagedLines > 0 && (
            <span className="rounded-full bg-late-soft px-2 py-0.5 text-late">{plural(r.shortLines + r.damagedLines, "line")} short/damaged</span>
          )}
          {r.staleLines > 0 && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-warn">{plural(r.staleLines, "line")} to re-check</span>}
          {queued > 0 && <span className="rounded-full bg-warn-soft px-2 py-0.5 font-medium text-warn">{queued} queued on this device</span>}
          {r.canRelease && t.state === "LOADING" && <span className="rounded-full bg-lime px-2 py-0.5 font-semibold text-ink">Ready to release</span>}
          <ChevronRight className="ml-auto size-4 text-muted-foreground" />
        </div>
      </LoaderLink>
    </li>
  );
}
