"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Clock, MapPin, MapPinCheck, ParkingCircle, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getEvidenceBlob, OfflineStorageError, useNavigatorOnline, type PendingEvent } from "@/lib/offline";
import { fetchTrip, fetchTripList, queueArrive } from "../client-actions";
import { clock, STOP_STATE_LABEL } from "../format";
import { useTrip, useTripIdForStop } from "../hooks";
import { isTerminal, type ProjectedStop, type ProjectedTrip } from "../projection";
import { DriverLink, useDriver } from "../session";
import { bigButton, Section, StateBadge, SyncBadge, TempChip } from "./bits";
import { IssueForm } from "./issue-form";
import { OutcomeForm } from "./outcome-form";
import { StatusStrip } from "./status-strip";
import { NoRouteDownloaded, RefreshError, RevokedBanner } from "./states";

export function StopView({ stopId }: { stopId: string }) {
  const { scope } = useDriver();
  const tripId = useTripIdForStop(stopId);
  const online = useNavigatorOnline();
  // Opened directly online without the trip downloaded: fetch this driver's trips once to find it.
  const lookup = useQuery({
    queryKey: ["driver", "find-stop", stopId],
    queryFn: async () => {
      const list = await fetchTripList(scope);
      await Promise.all(list.items.map((t) => fetchTrip(scope, t.id).catch(() => null)));
      return true;
    },
    enabled: tripId === null && online,
    retry: false,
    staleTime: Infinity,
  });
  const looking = lookup.isFetching;

  return (
    <div className="mx-auto max-w-xl">
      <StatusStrip />
      {tripId === undefined || (tripId === null && looking) ? (
        <Skeleton className="h-48 w-full rounded-2xl" />
      ) : tripId === null ? (
        <NoRouteDownloaded />
      ) : (
        <StopInTrip tripId={tripId} stopId={stopId} />
      )}
    </div>
  );
}

function StopInTrip({ tripId, stopId }: { tripId: string; stopId: string }) {
  const { trip, refresh, revoked } = useTrip(tripId);
  if (trip === undefined) return <Skeleton className="h-48 w-full rounded-2xl" />;
  if (trip === null) return <NoRouteDownloaded />;
  const index = trip.stops.findIndex((s) => s.stopId === stopId);
  const stop = trip.stops[index];
  if (!stop) return <NoRouteDownloaded />;
  return (
    <>
      <DriverLink href={`/driver/trips/${trip.id}`} className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="size-4" /> Trip {trip.tripNumber} · <span className="font-id">{trip.vehicleId}</span>
      </DriverLink>
      {revoked && <RevokedBanner message={revoked.message} />}
      <RefreshError error={revoked ? null : refresh.error} />
      <StopBody trip={trip} stop={stop} index={index} />
    </>
  );
}

function StopBody({ trip, stop, index }: { trip: ProjectedTrip; stop: ProjectedStop; index: number }) {
  const [issueOpen, setIssueOpen] = useState(false);
  const earlierOpen = trip.stops.slice(0, index).find((s) => !isTerminal(s.state));
  const stopIssues = trip.issues.filter((i) => i.stopId === stop.stopId);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          Stop {stop.sequence} of {trip.stops.length}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{stop.outletLabel}</h1>
          <StateBadge state={stop.state} kind="stop" />
        </div>
        {stop.state !== stop.confirmedState && (
          <p className="mt-1 text-xs text-warn">Server still shows: {STOP_STATE_LABEL[stop.confirmedState]}</p>
        )}
        <ul className="mt-3 space-y-1.5 text-sm">
          <li className="flex items-center gap-2">
            <MapPin className="size-4 text-muted-foreground" /> {stop.district} district · outlet <span className="font-id">{stop.outletId}</span>
          </li>
          <li className="flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" /> Receiving window <span className="font-id">{stop.windowOpen}–{stop.windowClose}</span>
          </li>
          <li className="flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" /> Planned <span className="font-id">{clock(stop.plannedArrivalAt)}</span>
            {stop.etaAt && (
              <>
                · ETA <span className="font-id">{clock(stop.etaAt)}</span>
              </>
            )}
            · {stop.plannedServiceMin} min to unload
          </li>
          {stop.parkingConstraint !== "NORMAL" && (
            <li className="flex items-center gap-2 font-medium text-warn">
              <ParkingCircle className="size-4" />
              {stop.parkingConstraint === "VAN_ONLY"
                ? "Van access only"
                : `Mall dock${stop.mallWindowOpen ? `, dock open ${stop.mallWindowOpen}–${stop.mallWindowClose}` : ""}`}
            </li>
          )}
        </ul>
      </section>

      <Section title="Goods for this stop">
        <div className="space-y-3">
          {stop.orders.map((o) => (
            <div key={o.orderId} className="rounded-xl border p-3">
              <div className="flex items-center gap-2">
                <span className="font-id text-sm font-semibold">{o.orderRef}</span>
                <TempChip temp={o.temp} />
                <span className="ml-auto text-xs text-muted-foreground">
                  {o.totals.units} units · {Math.round(o.totals.weightKg)} kg
                </span>
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {o.lines.map((l) => {
                  const loaded = l.check?.loadedUnits;
                  return (
                    <li key={l.orderLineId} className="flex justify-between gap-3">
                      <span>{l.description}</span>
                      <span className="shrink-0 font-id">
                        {loaded === undefined ? (
                          <span className="text-late">unchecked</span>
                        ) : loaded < l.expectedUnits ? (
                          <span className="text-warn">
                            {loaded}/{l.expectedUnits}
                          </span>
                        ) : (
                          loaded
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Quantities are what the loader checked onto the vehicle.</p>
      </Section>

      <Section title={isTerminal(stop.state) ? "Outcome" : stop.state === "ARRIVED" ? "Record the outcome" : "Arrival"}>
        {trip.state !== "IN_TRANSIT" && !isTerminal(stop.state) ? (
          <p className="text-sm text-muted-foreground">
            {trip.state === "COMPLETED" ? "This trip is finished." : "Depart from the trip page before recording deliveries."}
          </p>
        ) : stop.state === "PENDING" ? (
          earlierOpen ? (
            <p className="flex gap-2 text-sm text-warn">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" /> Finish stop {earlierOpen.sequence} ({earlierOpen.outletId}) first. Stops are
              delivered in order.
            </p>
          ) : (
            <ArriveButton trip={trip} stop={stop} />
          )
        ) : stop.state === "ARRIVED" ? (
          <>
            <p className="mb-3 text-sm">
              Arrived at <span className="font-id">{clock(stop.localArrivalAt ?? trip.stopEvents[stop.stopId]?.actualArrivalAt)}</span>{" "}
              <SyncBadge events={stop.localEvents.filter((e) => e.kind === "stop.arrive")} />
            </p>
            <OutcomeForm trip={trip} stop={stop} />
          </>
        ) : (
          <OutcomeSummary trip={trip} stop={stop} />
        )}
      </Section>

      {trip.state !== "COMPLETED" && (
        <Section
          title="Report an issue"
          action={
            <Button variant="ghost" size="sm" onClick={() => setIssueOpen((o) => !o)} data-testid="toggle-issue">
              {issueOpen ? "Close" : "Open"}
            </Button>
          }
        >
          {issueOpen ? (
            <IssueForm trip={trip} stop={stop} onDone={() => setIssueOpen(false)} />
          ) : (
            <p className="text-sm text-muted-foreground">Delay, no access, damage or anything the dispatcher should know.</p>
          )}
          {(stop.localIssues.length > 0 || stopIssues.length > 0) && (
            <ul className="mt-3 space-y-2 text-sm">
              {stop.localEvents
                .filter((e) => e.kind === "stop.issue")
                .map((e) => (
                  <li key={e.eventId} className="rounded-lg bg-warn-soft p-2">
                    <span className="font-medium">{e.label}</span> · <SyncBadge events={[e]} />
                    <p>{(e.payload as { text: string }).text}</p>
                  </li>
                ))}
              {stopIssues.map((i) => (
                <li key={i.id} className="rounded-lg bg-secondary p-2">
                  <span className="font-medium">{i.type.toLowerCase()}</span> · {i.status.toLowerCase()} · sent to dispatcher
                  <p className="text-muted-foreground">{i.text}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  );
}

function ArriveButton({ trip, stop }: { trip: ProjectedTrip; stop: ProjectedStop }) {
  const { scope } = useDriver();
  const [busy, setBusy] = useState(false);
  async function arrive() {
    setBusy(true);
    try {
      await queueArrive(scope, trip, stop);
      toast.success("Arrival saved on this phone");
    } catch (err) {
      toast.error(err instanceof OfflineStorageError ? err.message : "Could not save the arrival. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button className={bigButton} onClick={arrive} disabled={busy} data-testid="arrive">
        <MapPinCheck className="size-5" /> Arrived
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">Tap only when the vehicle is parked. Never use the app while driving.</p>
    </>
  );
}

function OutcomeSummary({ trip, stop }: { trip: ProjectedTrip; stop: ProjectedStop }) {
  const confirmed = trip.stopEvents[stop.stopId]?.proof ?? null;
  const local = stop.localOutcome;
  const outcomeEvent = stop.localEvents.find((e) => e.kind === "stop.outcome");
  const lineOutcomes = local
    ? local.lines
    : (trip.stopEvents[stop.stopId]?.lineOutcomes ?? []).map((l) => ({ orderLineId: l.orderLineId, deliveredUnits: l.deliveredUnits, damagedUnits: l.damagedUnits }));
  const lineName = new Map(stop.orders.flatMap((o) => o.lines.map((l) => [l.orderLineId, `${l.description}`] as const)));
  const recipient = local?.recipientName ?? confirmed?.recipientName;
  const reason = local?.failureReason ?? confirmed?.failureReason;

  return (
    <div className="space-y-3 text-sm" data-testid="outcome-summary">
      <div className="flex flex-wrap items-center gap-2">
        <StateBadge state={stop.state} kind="stop" />
        <SyncBadge events={stop.localEvents.filter((e) => e.kind === "stop.outcome" || e.kind === "stop.arrive")} />
      </div>
      {recipient && <p>Recipient: {recipient}</p>}
      {reason && <p>Reason: {reason}</p>}
      <ul className="space-y-1">
        {lineOutcomes.map((l) => (
          <li key={l.orderLineId} className="flex justify-between gap-3">
            <span>{lineName.get(l.orderLineId)}</span>
            <span className="font-id">
              {l.deliveredUnits}
              {l.damagedUnits > 0 && <span className="text-late"> ({l.damagedUnits} damaged)</span>}
            </span>
          </li>
        ))}
      </ul>
      {outcomeEvent ? (
        <LocalPhotos event={outcomeEvent} />
      ) : confirmed && confirmed.attachments.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {confirmed.attachments.map((a) => (
            <li key={a.id}>
              <a href={a.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked attachment route */}
                <img src={a.url} alt="Delivery evidence" className="size-20 rounded-lg bg-secondary object-cover" />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {confirmed && <p className="text-xs text-muted-foreground">Server received this at {clock(confirmed.submittedAt)}.</p>}
    </div>
  );
}

function LocalPhotos({ event }: { event: PendingEvent }) {
  const { scope } = useDriver();
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    void Promise.all(event.fileRefs.map((f) => getEvidenceBlob(scope, f.clientFileId))).then((files) => {
      if (!alive) return;
      for (const f of files) if (f) made.push(URL.createObjectURL(f.blob));
      setUrls(made);
    });
    return () => {
      alive = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [event, scope]);
  if (event.fileRefs.length === 0) return null;
  return (
    <div>
      <ul className="flex flex-wrap gap-2" data-testid="local-photos">
        {urls.map((u) => (
          <li key={u}>
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
            <img src={u} alt="Evidence stored on this phone" className="size-20 rounded-lg object-cover" />
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">
        {event.fileRefs.length} photo{event.fileRefs.length === 1 ? "" : "s"} stored on this phone until the server confirms.
      </p>
    </div>
  );
}
