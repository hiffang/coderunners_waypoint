"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Clock, Home, MapPin, PlayCircle, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingScreen } from "@/components/loading-screen";
import { OfflineStorageError, useNavigatorOnline } from "@/lib/offline";
import { cn } from "@/lib/utils";
import { ApiClientError } from "@/shared/api";
import { brandLabel } from "@/shared/dto/reference";
import { departOnline, fetchTrip, newId, queueReturn } from "../client-actions";
import { ago, clock, dayLabel, TRIP_STATE_LABEL } from "../format";
import { useTrip } from "../hooks";
import { isTerminal, type ProjectedTrip } from "../projection";
import { DriverLink, useDriver } from "../session";
import { bigButton, Section, StateBadge, SyncBadge, TempChip } from "./bits";
import { StatusStrip } from "./status-strip";
import { NoRouteDownloaded, RefreshError, RevokedBanner } from "./states";

export function TripView({ tripId }: { tripId: string }) {
  const { trip, savedAt, refresh, revoked } = useTrip(tripId);

  return (
    <div className="mx-auto max-w-xl">
      <StatusStrip />
      <DriverLink href="/driver" className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="size-4" /> My routes
      </DriverLink>
      {revoked && <RevokedBanner message={revoked.message} />}
      <RefreshError error={revoked ? null : refresh.error} />
      {trip === undefined || (trip === null && refresh.isFetching) ? (
        <LoadingScreen portal="driver" title="Loading your trip" />
      ) : trip === null ? (
        <NoRouteDownloaded />
      ) : (
        <TripBody trip={trip} savedAt={savedAt} />
      )}
    </div>
  );
}

function TripBody({ trip, savedAt }: { trip: ProjectedTrip; savedAt: string | null }) {
  const allDone = trip.stops.every((s) => isTerminal(s.state));
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">
            {dayLabel(trip.serviceDate)} · Trip {trip.tripNumber}
          </h1>
          <StateBadge state={trip.state} kind="trip" />
        </div>
        {trip.state !== trip.confirmedState && (
          <p className="mt-1 text-xs text-warn">Server still shows: {TRIP_STATE_LABEL[trip.confirmedState]}</p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-id">{trip.vehicleId}</span> · {brandLabel(trip.brand)} {trip.district} · from {trip.depotName}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Planned depart</dt>
          <dd className="font-id">{clock(trip.plannedDepartureAt)}</dd>
          <dt className="text-muted-foreground">Planned back</dt>
          <dd className="font-id">{clock(trip.plannedReturnAt)}</dd>
          <dt className="text-muted-foreground">Load</dt>
          <dd>
            {Math.round(trip.load.weightKg)} kg · {trip.load.volumeM3.toFixed(2)} m³
          </dd>
          <dt className="text-muted-foreground">Plan</dt>
          <dd className="font-id text-xs leading-5">
            rev {trip.planRevision} · v{trip.version}
          </dd>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">Downloaded {ago(savedAt)} · server time of copy {clock(trip.snapshotAt)}</p>
      </section>

      {(trip.state === "PLANNED" || trip.state === "LOADING" || trip.state === "READY") && <DepartCard trip={trip} />}

      <Section title={`Stops in delivery order (${trip.stops.length})`}>
        <ol className="space-y-3">
          {trip.stops.map((s, i) => {
            const current = i === trip.currentStopIndex;
            const units = s.orders.reduce((n, o) => n + o.totals.units, 0);
            return (
              <li key={s.stopId}>
                <DriverLink
                  href={`/driver/stops/${s.stopId}`}
                  className={cn(
                    "block rounded-xl border p-3 transition-colors",
                    current ? "border-ink bg-lime-soft" : "bg-background/40 hover:border-ink/40",
                  )}
                  data-testid="stop-card"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-full font-id text-sm font-semibold",
                        current ? "bg-ink text-white" : "bg-secondary",
                      )}
                    >
                      {s.sequence}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{s.outletLabel}</span>
                        <StateBadge state={s.state} kind="stop" />
                        {current && <span className="text-xs font-semibold uppercase tracking-wide">Next</span>}
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3.5" /> window <span className="font-id">{s.windowOpen}–{s.windowClose}</span>
                        </span>
                        <span>
                          ETA <span className="font-id">{clock(s.etaAt ?? s.plannedArrivalAt)}</span>
                        </span>
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
                        {s.orders.map((o) => (
                          <span key={o.orderId} className="inline-flex items-center gap-1">
                            <span className="font-id text-xs">{o.orderRef}</span>
                            <TempChip temp={o.temp} />
                          </span>
                        ))}
                        <span className="text-muted-foreground">· {units} units</span>
                      </div>
                      {(s.localEvents.length > 0 || s.state !== "PENDING") && (
                        <div className="mt-1.5">
                          <SyncBadge events={s.localEvents} />
                        </div>
                      )}
                    </div>
                  </div>
                </DriverLink>
              </li>
            );
          })}
        </ol>
      </Section>

      {trip.state === "IN_TRANSIT" && allDone && <ReturnCard trip={trip} />}
      {trip.localReturnAt && (
        <div className="rounded-2xl border border-warn/30 bg-warn-soft p-4 text-sm" data-testid="return-local">
          <p className="font-semibold">Return saved on phone at {clock(trip.localReturnAt)} · not sent yet</p>
          <p className="mt-1">Fuel and the next trip are only released after this reaches the server.</p>
        </div>
      )}
      {trip.confirmedState === "COMPLETED" && (
        <div className="rounded-2xl border bg-lime-soft p-4 text-sm text-fresh">
          Returned to {trip.depotName} at {clock(trip.returnedAt)} (confirmed by server).
        </div>
      )}

      {trip.issues.length > 0 && (
        <Section title="Issues on this trip">
          <ul className="space-y-2 text-sm">
            {trip.issues.map((i) => (
              <li key={i.id} className="rounded-lg bg-secondary p-2">
                <span className="font-semibold">{i.type.toLowerCase()}</span> · {i.status.toLowerCase()} · {i.reporter.role.toLowerCase()}
                <p className="text-muted-foreground">{i.text}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function DepartCard({ trip }: { trip: ProjectedTrip }) {
  const { scope } = useDriver();
  const online = useNavigatorOnline();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per departure attempt, reused when the answer was lost, so a resend can never depart twice.
  const keyRef = useRef<string | null>(null);

  async function depart() {
    setBusy(true);
    setError(null);
    keyRef.current ??= newId();
    try {
      await departOnline(trip, keyRef.current);
      keyRef.current = null;
      toast.success("Departure confirmed by the server");
      await fetchTrip(scope, trip.id).catch(() => {});
      await qc.invalidateQueries({ queryKey: ["driver"] });
    } catch (err) {
      if (err instanceof ApiClientError) {
        keyRef.current = null; // the server answered; a new attempt is a new action
        const blockers = (err.details as { blockers?: string[] } | undefined)?.blockers;
        setError(blockers?.length ? blockers.join(" · ") : err.message);
        await fetchTrip(scope, trip.id).catch(() => {});
      } else if (err instanceof OfflineStorageError) {
        setError(err.message);
      } else {
        setError("No answer from the server. Check your connection and tap Depart again; it will not depart twice.");
      }
    } finally {
      setBusy(false);
    }
  }

  const { canDepart, blockers } = trip.departure;
  return (
    <Section title="Departure">
      {canDepart ? (
        <p className="mb-3 text-sm text-fresh">The warehouse released this load for plan revision {trip.planRevision}.</p>
      ) : (
        <ul className="mb-3 space-y-1 text-sm" data-testid="depart-blockers">
          {blockers.map((b) => (
            <li key={b} className="flex gap-2 text-warn">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {b}
            </li>
          ))}
        </ul>
      )}
      <Button className={bigButton} disabled={!canDepart || busy || !online} onClick={depart} data-testid="depart">
        <PlayCircle className="size-5" /> {busy ? "Checking with server…" : "Depart"}
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        {online
          ? "Departure is checked online against the warehouse release and the current plan."
          : "Departure needs a connection: only the server can confirm the warehouse release."}
      </p>
      {error && (
        <p className="mt-2 rounded-lg bg-late-soft p-2 text-sm text-late" role="alert">
          {error}
        </p>
      )}
    </Section>
  );
}

function ReturnCard({ trip }: { trip: ProjectedTrip }) {
  const { scope } = useDriver();
  const [busy, setBusy] = useState(false);
  async function back() {
    setBusy(true);
    try {
      await queueReturn(scope, trip);
      toast.success("Return saved on this phone. It is sent automatically when online.");
    } catch (err) {
      toast.error(err instanceof OfflineStorageError ? err.message : "Could not save the return. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Back at the depot">
      <p className="mb-3 flex items-start gap-2 text-sm text-muted-foreground">
        <MapPin className="mt-0.5 size-4 shrink-0" /> Every stop has an outcome. Record the return once you are parked at {trip.depotName}.
      </p>
      <Button className={bigButton} onClick={back} disabled={busy} data-testid="return">
        <Home className="size-5" /> Returned to depot
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">Fuel is booked as the planned litres (estimate; no fuel telemetry).</p>
    </Section>
  );
}
