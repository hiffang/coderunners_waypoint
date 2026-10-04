"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { KeyRound, LogOut, RefreshCw, TriangleAlert, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  discardEvent,
  otherAccountsWithWork,
  purgeScope,
  rebaseEvent,
  retryEvent,
  UnsyncedWorkError,
  useNavigatorOnline,
  useOutbox,
  useSyncState,
  type PendingEvent,
} from "@/lib/offline";
import { cn } from "@/lib/utils";
import { ApiClientError } from "@/shared/api";
import { fetchTrip } from "../client-actions";
import { ago, clock, dayLabel, STOP_STATE_LABEL, TRIP_STATE_LABEL } from "../format";
import { useStoredTrips } from "../hooks";
import { DriverLink, useDriver } from "../session";
import type { DriverTripSnapshotDto } from "../types";
import { bigButton, Section } from "./bits";

const STATUS_TONE: Record<PendingEvent["status"], string> = {
  pending: "bg-warn-soft text-warn",
  sending: "bg-secondary text-foreground",
  acknowledged: "bg-lime-soft text-fresh",
  conflict: "bg-late-soft text-late",
  blocked: "bg-late-soft text-late",
};
const STATUS_LABEL: Record<PendingEvent["status"], string> = {
  pending: "Saved on phone",
  sending: "Sending",
  acknowledged: "Confirmed by server",
  conflict: "Conflict",
  blocked: "Rejected / waiting",
};

export function SyncView() {
  const { scope, syncNow, displayName } = useDriver();
  const state = useSyncState(scope);
  const events = useOutbox(scope);
  const stored = useStoredTrips();
  const online = useNavigatorOnline();
  const [others, setOthers] = useState<Awaited<ReturnType<typeof otherAccountsWithWork>>>([]);

  useEffect(() => {
    void otherAccountsWithWork(scope).then(setOthers).catch(() => {});
  }, [scope, events]);

  const unsettled = (events ?? []).filter((e) => e.status !== "acknowledged");
  const confirmed = (events ?? []).filter((e) => e.status === "acknowledged").slice(-10).reverse();

  async function manualSync() {
    const r = await syncNow();
    const res = r as { acknowledged: number; offline: boolean; paused: string | null } | null;
    if (!res) return;
    if (res.paused === "auth") toast.warning("Sign in again to send your saved work");
    else if (res.offline) toast.warning("Still offline. Your work stays saved on this phone.");
    else toast.success(res.acknowledged ? `${res.acknowledged} action${res.acknowledged === 1 ? "" : "s"} confirmed by the server` : "Nothing left to send");
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Sync</h1>
        <p className="text-sm text-muted-foreground">
          {displayName} · {online ? "connected" : "offline"}
        </p>
      </header>

      {state?.paused === "auth" && (
        <div className="flex gap-3 rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm" data-testid="paused-auth">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-warn" />
          <div>
            Your session expired, so sending is paused. Nothing is lost.{" "}
            <a className="font-semibold underline" href="/login?callbackUrl=/driver/sync">
              Sign in again
            </a>{" "}
            as <b>{displayName}</b> to continue. Work saved by this account is never sent under another login.
          </div>
        </div>
      )}
      {state?.paused === "account" && (
        <div className="flex gap-3 rounded-xl border border-late/30 bg-late-soft p-3 text-sm text-late">
          <UserX className="mt-0.5 size-4 shrink-0" />
          <div>A different account is signed in on this phone. {displayName}&apos;s saved work stays here and is not sent.</div>
        </div>
      )}

      <Section title="Waiting on this phone">
        <dl className="grid grid-cols-3 gap-2 text-center">
          <Stat label="To send" value={(state?.pending ?? 0) + (state?.sending ?? 0)} />
          <Stat label="Need attention" value={(state?.conflict ?? 0) + (state?.blocked ?? 0)} tone={(state?.conflict ?? 0) + (state?.blocked ?? 0) > 0 ? "text-late" : undefined} />
          <Stat label="Photos" value={state?.unsentFiles ?? 0} />
        </dl>
        <Button className={cn(bigButton, "mt-4")} onClick={manualSync} disabled={state?.syncing} data-testid="sync-now">
          <RefreshCw className={cn("size-5", state?.syncing && "animate-spin")} /> {state?.syncing ? "Sending…" : "Sync now"}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Last attempt {ago(state?.lastAttemptAt)} · last complete sync {ago(state?.lastSuccessAt)}. Sending also happens automatically when
          the connection returns or you reopen the app.
        </p>
      </Section>

      <Section title={`Actions not yet confirmed (${unsettled.length})`}>
        {unsettled.length === 0 ? (
          <p className="text-sm text-muted-foreground">Everything you recorded has been confirmed by the server.</p>
        ) : (
          <ul className="space-y-3" data-testid="unsettled-list">
            {unsettled.map((e) => (
              <EventCard key={e.eventId} event={e} />
            ))}
          </ul>
        )}
      </Section>

      {confirmed.length > 0 && (
        <Section title="Recently confirmed">
          <ul className="space-y-2 text-sm">
            {confirmed.map((e) => (
              <li key={e.eventId} className="flex justify-between gap-3">
                <span>{e.label}</span>
                <span className="shrink-0 text-xs text-fresh">server {clock((e.result as { serverAt?: string } | undefined)?.serverAt)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Saved on this phone">
        {!stored || stored.length === 0 ? (
          <p className="text-sm text-muted-foreground">No routes downloaded.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {stored.map(({ snapshot, savedAt }) => (
              <li key={snapshot.id} className="flex justify-between gap-3">
                <DriverLink href={`/driver/trips/${snapshot.id}`} className="underline-offset-2 hover:underline">
                  {dayLabel(snapshot.serviceDate)} · trip {snapshot.tripNumber} · <span className="font-id">{snapshot.vehicleId}</span>
                </DriverLink>
                <span className="shrink-0 text-xs text-muted-foreground">saved {ago(savedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {others.length > 0 && (
        <div className="flex gap-3 rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
          <div>
            {others.map((o) => (
              <p key={o.scopeKey}>
                {o.account?.displayName ?? "Another account"} has {o.unsettled} unsent action{o.unsettled === 1 ? "" : "s"} on this phone. Only
                that account can send them after signing in.
              </p>
            ))}
          </div>
        </div>
      )}

      <SignOutCard unsettled={unsettled.length} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl bg-secondary p-3">
      <dd className={cn("font-id text-2xl font-semibold", tone)}>{value}</dd>
      <dt className="text-xs text-muted-foreground">{label}</dt>
    </div>
  );
}

function EventCard({ event }: { event: PendingEvent }) {
  const { scope, syncNow } = useDriver();
  const [check, setCheck] = useState<{ snap?: DriverTripSnapshotDto; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const tripId = event.meta.tripId as string | undefined;

  async function inspect() {
    if (!tripId) return;
    setBusy(true);
    try {
      setCheck({ snap: await fetchTrip(scope, tripId) });
    } catch (err) {
      setCheck({ error: err instanceof ApiClientError ? err.message : "Server not reachable; try again when connected." });
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    const n = event.fileRefs.length;
    const ok = window.confirm(
      `Discard "${event.label}"${n ? ` and its ${n} photo${n === 1 ? "" : "s"}` : ""}? Actions saved after it for the same stop are discarded too. This cannot be undone.`,
    );
    if (!ok) return;
    const removed = await discardEvent(scope, event.eventId);
    toast.success(`Discarded ${removed.length} action${removed.length === 1 ? "" : "s"}`);
  }

  async function retry() {
    await retryEvent(scope, event.eventId);
    await syncNow();
  }

  const reapply = check?.snap ? reapplyPlan(event, check.snap) : null;

  async function doReapply() {
    if (!reapply?.ok) return;
    setBusy(true);
    try {
      await rebaseEvent(scope, event.eventId, {
        baseVersion: reapply.version,
        planRevision: reapply.planRevision,
        payload: { ...event.payload, expectedVersion: reapply.version, planRevision: reapply.planRevision },
      });
      setCheck(null);
      await syncNow();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border p-3" data-testid="event-card" data-status={event.status}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{event.label}</p>
          <p className="text-xs text-muted-foreground">
            recorded {clock(event.clientAt)} on this phone{event.fileRefs.length ? ` · ${event.fileRefs.length} photo(s)` : ""}
            {event.retryCount ? ` · ${event.retryCount} attempt(s)` : ""}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_TONE[event.status])}>{STATUS_LABEL[event.status]}</span>
      </div>
      {event.lastError && (
        <p className={cn("mt-2 rounded-lg p-2 text-sm", event.status === "pending" ? "bg-secondary" : "bg-late-soft text-late")}>
          {event.lastError.message}
          {event.lastError.status ? <span className="ml-1 font-id text-xs">({event.lastError.code})</span> : null}
        </p>
      )}
      {(event.status === "conflict" || event.status === "blocked") && (
        <div className="mt-3 space-y-2">
          {event.status === "conflict" && !check && (
            <Button variant="outline" className="h-11 w-full rounded-xl" onClick={inspect} disabled={busy}>
              Check what the server has now
            </Button>
          )}
          {check?.error && <p className="text-sm text-late">{check.error} Only discarding is possible.</p>}
          {reapply && (
            <div className="rounded-lg bg-secondary p-2 text-sm">
              <p>{reapply.summary}</p>
              {reapply.ok ? (
                <Button className="mt-2 h-11 w-full rounded-xl" onClick={doReapply} disabled={busy} data-testid="reapply">
                  Re-apply my action to the current version
                </Button>
              ) : (
                <p className="mt-1 font-medium">{reapply.reason}</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {event.status === "blocked" && (
              <Button variant="outline" className="h-11 rounded-xl" onClick={retry}>
                Try again
              </Button>
            )}
            <Button variant="destructive" className={cn("h-11 rounded-xl", event.status === "conflict" && "col-span-2")} onClick={discard}>
              Discard
            </Button>
          </div>
        </div>
      )}
      {event.status === "pending" && event.lastError && (
        <Button variant="outline" className="mt-2 h-11 w-full rounded-xl" onClick={() => syncNow()}>
          Retry now
        </Button>
      )}
    </li>
  );
}

/** Can a conflicted action be explicitly re-applied on top of the server's current state? */
function reapplyPlan(event: PendingEvent, snap: DriverTripSnapshotDto) {
  const rev =
    event.planRevision !== null && event.planRevision !== snap.planRevision
      ? ` The plan was revised (rev ${event.planRevision} → ${snap.planRevision}); check the stop before re-applying.`
      : "";
  if (event.entityType === "Trip") {
    const ok = event.kind === "trip.return" && snap.state === "IN_TRANSIT" && snap.stops.every((s) => ["DELIVERED", "PARTIAL", "FAILED"].includes(s.state));
    return {
      ok,
      version: snap.version,
      planRevision: snap.planRevision,
      summary: `Server: trip is ${TRIP_STATE_LABEL[snap.state]} (v${snap.version}).${rev}`,
      reason: ok ? "" : "The trip is not in a state where this return can be recorded.",
    };
  }
  const stop = snap.stops.find((s) => s.stopId === event.entityId);
  if (!stop) return { ok: false, version: 0, planRevision: snap.planRevision, summary: "This stop is no longer on your route.", reason: "Only discarding is possible." };
  const allowed =
    snap.state !== "COMPLETED" &&
    ((event.kind === "stop.arrive" && stop.state === "PENDING") ||
      (event.kind === "stop.outcome" && stop.state === "ARRIVED") ||
      event.kind === "stop.issue");
  return {
    ok: allowed,
    version: stop.version,
    planRevision: snap.planRevision,
    summary: `Server: stop ${stop.sequence} is ${STOP_STATE_LABEL[stop.state]} (v${stop.version}).${rev}`,
    reason: allowed ? "" : "The server already has a different result for this stop. Discard yours, or ask the dispatcher.",
  };
}

function SignOutCard({ unsettled }: { unsettled: number }) {
  const { scope } = useDriver();
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  async function leave() {
    try {
      await purgeScope(scope, { discardUnsynced: confirmDiscard });
      await signOut({ callbackUrl: "/login" });
    } catch (err) {
      if (err instanceof UnsyncedWorkError) toast.error(`${err.message}. Sync first, or tick the box to discard it.`);
      else toast.error("Could not clear this phone");
    }
  }

  return (
    <Section title="Finish on this phone">
      <p className="text-sm text-muted-foreground">Signing out here removes your routes and photos from this phone.</p>
      {unsettled > 0 && (
        <label className="mt-3 flex items-start gap-2 rounded-lg bg-late-soft p-2 text-sm text-late">
          <input type="checkbox" className="mt-1 size-4" checked={confirmDiscard} onChange={(e) => setConfirmDiscard(e.target.checked)} />
          <span>
            {unsettled} action{unsettled === 1 ? " is" : "s are"} not confirmed by the server. Discard {unsettled === 1 ? "it" : "them"} and sign out
            anyway.
          </span>
        </label>
      )}
      <Button variant="outline" className={cn(bigButton, "mt-3")} onClick={leave} disabled={unsettled > 0 && !confirmDiscard} data-testid="sign-out-clear">
        <LogOut className="size-5" /> Sign out and clear this phone
      </Button>
    </Section>
  );
}
