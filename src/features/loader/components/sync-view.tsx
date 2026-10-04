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
import { fetchManifest } from "../client-actions";
import { ago, clock, dayLabel, plural, TRIP_STATE_LABEL } from "../format";
import { useStoredManifests } from "../hooks";
import type { ChecksPayload, IssuePayload } from "../projection";
import { LoaderLink, useLoader } from "../session";
import type { LoaderManifestDto } from "../types";
import { bigButton, Section, Stat } from "./bits";

const STATUS_TONE: Record<PendingEvent["status"], string> = {
  pending: "bg-warn-soft text-warn",
  sending: "bg-secondary text-foreground",
  acknowledged: "bg-lime-soft text-fresh",
  conflict: "bg-late-soft text-late",
  blocked: "bg-late-soft text-late",
};
const STATUS_LABEL: Record<PendingEvent["status"], string> = {
  pending: "Saved on device",
  sending: "Sending",
  acknowledged: "Confirmed by server",
  conflict: "Conflict",
  blocked: "Rejected / waiting",
};

/** /loader/sync: pending work, conflicts after a plan change, explicit reconciliation and shared-terminal sign-out. */
export function SyncView() {
  const { scope, syncNow, displayName } = useLoader();
  const state = useSyncState(scope);
  const events = useOutbox(scope);
  const stored = useStoredManifests();
  const online = useNavigatorOnline();
  const [others, setOthers] = useState<Awaited<ReturnType<typeof otherAccountsWithWork>>>([]);

  useEffect(() => {
    void otherAccountsWithWork(scope).then(setOthers).catch(() => {});
  }, [scope, events]);

  const unsettled = (events ?? []).filter((e) => e.status !== "acknowledged");
  const confirmed = (events ?? []).filter((e) => e.status === "acknowledged").slice(-10).reverse();

  async function manualSync() {
    const res = (await syncNow()) as { acknowledged: number; offline: boolean; paused: string | null } | null;
    if (!res) return;
    if (res.paused === "auth") toast.warning("Sign in again to send your saved work");
    else if (res.offline) toast.warning("Still offline. Your work stays saved on this device.");
    else toast.success(res.acknowledged ? `${plural(res.acknowledged, "action")} confirmed by the server` : "Nothing left to send");
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
            <a className="font-semibold underline" href="/login?callbackUrl=/loader/sync">
              Sign in again
            </a>{" "}
            as <b>{displayName}</b> to continue. Work saved by this account is never sent under another login.
          </div>
        </div>
      )}
      {state?.paused === "account" && (
        <div className="flex gap-3 rounded-xl border border-late/30 bg-late-soft p-3 text-sm text-late">
          <UserX className="mt-0.5 size-4 shrink-0" />
          <div>A different account is signed in on this device. {displayName}&apos;s saved work stays here and is not sent.</div>
        </div>
      )}

      <Section title="Waiting on this device">
        <dl className="grid grid-cols-2 gap-2">
          <Stat label="To send" value={(state?.pending ?? 0) + (state?.sending ?? 0)} />
          <Stat
            label="Need review"
            value={(state?.conflict ?? 0) + (state?.blocked ?? 0)}
            tone={(state?.conflict ?? 0) + (state?.blocked ?? 0) > 0 ? "text-late" : undefined}
          />
        </dl>
        <Button className={cn(bigButton, "mt-4")} onClick={manualSync} disabled={state?.syncing} data-testid="sync-now">
          <RefreshCw className={cn("size-5", state?.syncing && "animate-spin")} /> {state?.syncing ? "Sending…" : "Sync now"}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Last attempt {ago(state?.lastAttemptAt)} · last complete sync {ago(state?.lastSuccessAt)}. Sending also happens automatically when the
          connection returns.
        </p>
      </Section>

      <Section title={`Not yet confirmed (${unsettled.length})`}>
        {unsettled.length === 0 ? (
          <p className="text-sm text-muted-foreground">Everything recorded on this device has been confirmed by the server.</p>
        ) : (
          <ul className="space-y-3" data-testid="unsettled-list">
            {unsettled.map((e) => (
              <EventCard key={e.eventId} event={e} earlier={unsettled.filter((x) => x.meta.tripId === e.meta.tripId && x.seq < e.seq)} />
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

      <Section title="Manifests saved on this device">
        {!stored || stored.length === 0 ? (
          <p className="text-sm text-muted-foreground">No manifests downloaded.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {stored.map(({ manifest, savedAt }) => (
              <li key={manifest.id} className="flex justify-between gap-3">
                <LoaderLink href={`/loader/trips/${manifest.id}`} className="underline-offset-2 hover:underline">
                  {dayLabel(manifest.serviceDate)} · <span className="font-id">{manifest.vehicleId}</span> trip {manifest.tripNumber} · rev {manifest.planRevision}
                </LoaderLink>
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
                {o.account?.displayName ?? "Another account"} has {plural(o.unsettled, "unsent action")} on this device. Only that account can send
                them after signing in.
              </p>
            ))}
          </div>
        </div>
      )}

      <SignOutCard unsettled={unsettled.length} />
    </div>
  );
}

function EventCard({ event, earlier }: { event: PendingEvent; earlier: PendingEvent[] }) {
  const { scope, syncNow } = useLoader();
  const [check, setCheck] = useState<{ fresh?: LoaderManifestDto; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const tripId = event.meta.tripId as string | undefined;

  async function inspect() {
    if (!tripId) return;
    setBusy(true);
    try {
      setCheck({ fresh: await fetchManifest(scope, tripId) });
    } catch (err) {
      setCheck({ error: err instanceof ApiClientError ? err.message : "Server not reachable; try again when connected." });
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    const ok = window.confirm(
      `Discard "${event.label}"? Actions saved after it for the same trip are discarded too. The server never received them. This cannot be undone.`,
    );
    if (!ok) return;
    const removed = await discardEvent(scope, event.eventId);
    toast.success(`Discarded ${plural(removed.length, "action")}`);
  }

  async function retry() {
    await retryEvent(scope, event.eventId);
    await syncNow();
  }

  const plan = check?.fresh ? reapplyPlan(event, check.fresh, earlier) : null;

  async function doReapply() {
    if (!plan?.ok || !check?.fresh) return;
    setBusy(true);
    try {
      await rebaseEvent(scope, event.eventId, {
        baseVersion: check.fresh.version,
        planRevision: check.fresh.planRevision,
        payload: plan.payload,
      });
      setCheck(null);
      toast.success("Re-applied to the current manifest");
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
            recorded {clock(event.clientAt)} on this device · rev {event.planRevision ?? "?"}
            {event.retryCount ? ` · ${event.retryCount} attempt(s)` : ""}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_TONE[event.status])}>{STATUS_LABEL[event.status]}</span>
      </div>
      {event.kind === "loader.checks" && <CheckSummary payload={event.payload as unknown as ChecksPayload} />}
      {event.lastError && (
        <p className={cn("mt-2 rounded-lg p-2 text-sm", event.status === "pending" ? "bg-secondary" : "bg-late-soft text-late")}>
          {event.lastError.message}
          {event.lastError.status ? <span className="ml-1 font-id text-xs">({event.lastError.code})</span> : null}
        </p>
      )}
      {(event.status === "conflict" || event.status === "blocked") && (
        <div className="mt-3 space-y-2">
          {event.status === "conflict" && !check && (
            <Button variant="outline" className="h-11 w-full rounded-xl" onClick={inspect} disabled={busy} data-testid="inspect">
              Fetch the current manifest and compare
            </Button>
          )}
          {check?.error && <p className="text-sm text-late">{check.error}</p>}
          {plan && (
            <div className="rounded-lg bg-secondary p-2 text-sm" data-testid="reconcile">
              <p>{plan.summary}</p>
              {plan.details.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {plan.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
              {plan.ok ? (
                <Button className="mt-2 h-11 w-full rounded-xl" onClick={doReapply} disabled={busy} data-testid="reapply">
                  Re-apply to rev {check?.fresh?.planRevision}
                </Button>
              ) : (
                <p className="mt-1 font-medium">{plan.reason}</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {event.status === "blocked" && (
              <Button variant="outline" className="h-11 rounded-xl" onClick={retry}>
                Try again
              </Button>
            )}
            <Button variant="destructive" className={cn("h-11 rounded-xl", event.status === "conflict" && "col-span-2")} onClick={discard} data-testid="discard">
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

function CheckSummary({ payload }: { payload: ChecksPayload }) {
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {payload.checks.map((c) => `${c.loadedUnits} loaded${c.damageUnits ? `/${c.damageUnits} dmg` : ""}`).join(" · ")}
    </p>
  );
}

type Reapply = { ok: boolean; summary: string; details: string[]; reason: string; payload?: Record<string, unknown> };

/** Can a conflicted loader action be explicitly re-applied on top of the server's current manifest? */
function reapplyPlan(event: PendingEvent, fresh: LoaderManifestDto, earlier: PendingEvent[]): Reapply {
  const revised = event.planRevision !== null && event.planRevision !== fresh.planRevision;
  const summary = `Server: trip is ${TRIP_STATE_LABEL[fresh.state].toLowerCase()} (v${fresh.version}, rev ${fresh.planRevision}).${
    revised ? ` Plan was revised from rev ${event.planRevision}.` : ""
  }`;
  const no = (reason: string, details: string[] = []): Reapply => ({ ok: false, summary, details, reason });
  const base = { expectedVersion: fresh.version, planRevision: fresh.planRevision };

  if (earlier.length > 0) return no(`Review the earlier action for this trip first ("${earlier[0].label}").`);
  if (fresh.state === "IN_TRANSIT" || fresh.state === "COMPLETED") return no("The trip has departed; loading can no longer change. Discard this action.");

  if (event.kind === "loader.start") {
    if (fresh.state !== "PLANNED") return no("Loading is already started on the server. Discard this duplicate.");
    return { ok: true, summary, details: [], reason: "", payload: base };
  }

  const lines = new Map(
    fresh.stops.flatMap((s) => s.orders.flatMap((o) => o.lines.map((l) => [l.orderLineId, { ...l, orderId: o.orderId, orderRef: o.orderRef }] as const))),
  );

  if (event.kind === "loader.checks") {
    if (fresh.state === "PLANNED") return no("Loading is not started on the server. Start loading again, then re-check.");
    const p = event.payload as unknown as ChecksPayload;
    const details: string[] = [];
    const kept = p.checks.filter((c) => {
      const l = lines.get(c.orderLineId);
      if (!l) {
        details.push(`A checked line is no longer on this trip and will be dropped`);
        return false;
      }
      if (c.loadedUnits > l.expectedUnits) {
        details.push(`${l.orderRef} L${l.lineNo} ${l.description}: you loaded ${c.loadedUnits}, now only ${l.expectedUnits} expected — re-check it`);
        return false;
      }
      details.push(`${l.orderRef} L${l.lineNo} ${l.description}: ${c.loadedUnits} of ${l.expectedUnits} loaded${c.damageUnits ? `, ${c.damageUnits} damaged` : ""}`);
      return true;
    });
    if (kept.length === 0) return no("None of these checks fit the current manifest. Discard and check the lines again.", details);
    return { ok: true, summary, details, reason: "", payload: { ...base, checks: kept } };
  }

  if (event.kind === "loader.issue") {
    const p = event.payload as unknown as IssuePayload;
    const lineOk = !p.orderLineId || lines.has(p.orderLineId);
    const orderOk = !p.orderId || [...lines.values()].some((l) => l.orderId === p.orderId);
    if (!orderOk && p.type !== "OTHER") return no("The order in this report is no longer on this trip. Discard it, or report again.");
    const payload: Record<string, unknown> = { ...p, ...base };
    if (!lineOk) delete payload.orderLineId;
    if (!orderOk) delete payload.orderId;
    return { ok: true, summary, details: lineOk ? [] : ["The named line is no longer on the trip; the report will name the order only."], reason: "", payload };
  }

  return no("Unknown action. Discard it.");
}

/** Shared terminal: signing out clears this account's manifests and queued work from the device. */
function SignOutCard({ unsettled }: { unsettled: number }) {
  const { scope } = useLoader();
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  async function leave() {
    try {
      await purgeScope(scope, { discardUnsynced: confirmDiscard });
      await signOut({ callbackUrl: "/login" });
    } catch (err) {
      if (err instanceof UnsyncedWorkError) toast.error(`${err.message}. Sync first, or tick the box to discard it.`);
      else toast.error("Could not clear this device");
    }
  }

  return (
    <Section title="Finish on this shared device">
      <p className="text-sm text-muted-foreground">Signing out here removes your downloaded manifests and saved work, so the next loader cannot see them.</p>
      {unsettled > 0 && (
        <label className="mt-3 flex items-start gap-2 rounded-lg bg-late-soft p-2 text-sm text-late">
          <input type="checkbox" className="mt-1 size-4" checked={confirmDiscard} onChange={(e) => setConfirmDiscard(e.target.checked)} />
          <span>
            {plural(unsettled, "action")} {unsettled === 1 ? "is" : "are"} not confirmed by the server. Discard {unsettled === 1 ? "it" : "them"} and
            sign out anyway.
          </span>
        </label>
      )}
      <Button
        variant="outline"
        className={cn(bigButton, "mt-3")}
        onClick={leave}
        disabled={unsettled > 0 && !confirmDiscard}
        data-testid="sign-out-clear"
      >
        <LogOut className="size-5" /> Sign out and clear this device
      </Button>
    </Section>
  );
}
