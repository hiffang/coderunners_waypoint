"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowLeft, CheckCircle2, CircleAlert, History, Play, RefreshCw, Snowflake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LoadingScreen } from "@/components/loading-screen";
import { OfflineStorageError, useNavigatorOnline } from "@/lib/offline";
import { cn } from "@/lib/utils";
import { ApiClientError } from "@/shared/api";
import { brandLabel } from "@/shared/dto/reference";
import type { IssueDto } from "@/shared/dto/issue";
import { fetchManifest, newId, queueChecks, queueStart, releaseOnline, resolveIssueOnline } from "../client-actions";
import { ago, clock, dayLabel, ISSUE_STATUS_LABEL, ISSUE_TYPE_LABEL, kg, m3, PARKING_LABEL, plural, SEVERITY_LABEL, TEMP_HANDLING } from "../format";
import { useManifest } from "../hooks";
import { allLines, loadingOrder, type ProjectedManifest, type ProjectedStop } from "../projection";
import { lineStatus } from "../readiness";
import { LoaderLink, useLoader } from "../session";
import { bigButton, Section, StateBadge, Stat, SyncBadge, TempChip } from "./bits";
import { IssueForm, type IssuePrefill } from "./issue-form";
import { draftErrors, LineCheck, type LineDraft } from "./line-check";
import { NoManifestDownloaded, RefreshError, RevokedBanner } from "./states";
import { StatusStrip } from "./status-strip";

type Tab = "load" | "deliver" | "release";

/** /loader/trips/[id]: manifest, loading checklist, issues and release. */
export function TripView({ tripId }: { tripId: string }) {
  const { manifest, savedAt, refresh, revoked } = useManifest(tripId);
  const online = useNavigatorOnline();
  const [tab, setTab] = useState<Tab>("load");
  const [issue, setIssue] = useState<IssuePrefill | null>(null);

  if (manifest === undefined || (manifest === null && refresh.isPending && online)) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <LoadingScreen portal="loader" title="Loading your manifest" />
      </div>
    );
  }
  if (manifest === null) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackLink />
        <StatusStrip />
        <RefreshError error={refresh.error} />
        <NoManifestDownloaded online={online && !refresh.error} />
      </div>
    );
  }

  const m = manifest;
  const departed = m.state === "IN_TRANSIT" || m.state === "COMPLETED";
  const r = m.localReadiness;

  return (
    <div className="mx-auto max-w-3xl pb-28">
      <BackLink />
      <header className="mb-4 rounded-2xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-id text-2xl font-semibold">{m.vehicleId}</h1>
          <StateBadge state={m.state} />
          {m.state !== m.confirmedState && <span className="text-xs text-warn">(server: {m.confirmedState.toLowerCase()})</span>}
        </div>
        <p className="mt-1 text-sm">
          {dayLabel(m.serviceDate)} · trip {m.tripNumber} · {brandLabel(m.brand)} · {m.district} · {m.vehicleType === "TRUCK" ? "Truck" : "Van"}
          {m.refrigerated && (
            <span className="ml-1 inline-flex items-center gap-0.5 text-chilled">
              <Snowflake className="size-3.5" /> refrigerated
            </span>
          )}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <Fact label="Departs" value={<span className="font-id">{clock(m.plannedDepartureAt)}</span>} />
          <Fact label="Driver" value={m.driver?.name ?? "Unassigned"} />
          <Fact label="Load" value={`${kg(m.load.weightKg)} / ${kg(m.capacity.weightCapKg)}`} />
          <Fact label="Volume" value={`${m3(m.load.volumeM3)} / ${m3(m.capacity.volumeCapM3)}`} />
          <Fact label="Plan revision" value={<span className="font-id">rev {m.planRevision}</span>} />
          <Fact label="Published" value={ago(m.planPublishedAt)} />
          <Fact label="Last sync" value={savedAt ? ago(savedAt) : "never"} />
          <Fact label="This device" value={<SyncBadge events={m.localEvents} />} />
        </dl>
      </header>

      {revoked && <RevokedBanner message={revoked.message} />}
      <StatusStrip />
      <RefreshError error={refresh.error} />
      <DegradationBanners m={m} savedAt={savedAt} online={online} />

      {m.state === "PLANNED" && <StartCard m={m} />}

      <div className="sticky top-14 z-20 -mx-4 mb-4 bg-background/95 px-4 py-2 backdrop-blur" role="tablist" aria-label="Manifest views">
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-secondary p-1">
          {(
            [
              ["load", `Load (${r.checkedLines}/${r.totalLines})`],
              ["deliver", "Delivery order"],
              ["release", r.canRelease ? "Release ✓" : "Release"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              className={cn("h-10 rounded-lg text-sm font-medium", tab === k ? "bg-card shadow-sm" : "text-muted-foreground")}
              onClick={() => setTab(k)}
              data-testid={`tab-${k}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "load" && (
        <LoadChecklist
          m={m}
          disabled={departed || m.state === "PLANNED" || m.revisionMismatch || !!revoked}
          onReport={(p) => setIssue(p)}
        />
      )}
      {tab === "deliver" && <DeliveryOrder m={m} />}
      {tab === "release" && <ReleasePanel m={m} online={online} onRefreshed={() => refresh.refetch()} />}

      <IssuesPanel m={m} online={online} canReport={!departed && !revoked} onReport={() => setIssue({})} />

      <Dialog open={issue !== null} onOpenChange={(o) => !o && setIssue(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report shortfall or damage</DialogTitle>
            <DialogDescription>
              {m.vehicleId} trip {m.tripNumber} · rev {m.planRevision}
            </DialogDescription>
          </DialogHeader>
          {issue && <IssueForm manifest={m} prefill={issue} onDone={() => setIssue(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BackLink() {
  return (
    <LoaderLink href="/loader" className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> All manifests
    </LoaderLink>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

/** Stale or changed manifest, unsynced work and blocked release, each with the next step. */
function DegradationBanners({ m, savedAt, online }: { m: ProjectedManifest; savedAt: string | null; online: boolean }) {
  const qc = useQueryClient();
  const { scope } = useLoader();
  const [busy, setBusy] = useState(false);
  const old = useOlderThan(savedAt, 10 * 60_000);
  const queuedRevs = [...new Set(m.localEvents.map((e) => e.planRevision).filter((r): r is number => r !== null && r !== m.planRevision))];

  async function fetchLatest() {
    setBusy(true);
    try {
      await fetchManifest(scope, m.id);
      await qc.invalidateQueries({ queryKey: ["loader"] });
      toast.success("Latest manifest downloaded");
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Server not reachable");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {m.revisionMismatch && (
        <div className="rounded-xl border border-late/30 bg-late-soft p-3 text-sm text-late" data-testid="revision-changed">
          <p className="flex items-center gap-2 font-semibold">
            <History className="size-4" /> Plan revised: now rev {m.planRevision}
          </p>
          <p className="mt-1">
            {plural(m.localEvents.filter((e) => e.planRevision !== m.planRevision).length, "action")} on this device {queuedRevs.length ? `were recorded against rev ${queuedRevs.join(", ")}` : "use an older revision"} and
            will not be sent as-is. Review them on Sync: re-apply the ones that still fit the new manifest or discard them. Checklist editing is paused until then.
          </p>
          <LoaderLink href="/loader/sync" className="mt-2 inline-flex h-11 items-center rounded-xl bg-card px-4 font-medium text-foreground">
            Review queued work
          </LoaderLink>
        </div>
      )}
      {m.localReadiness.staleLines > 0 && !m.revisionMismatch && (
        <div className="rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm" data-testid="stale-lines">
          <b>{plural(m.localReadiness.staleLines, "line")}</b> were checked against an older plan revision. Check them again for rev {m.planRevision}{" "}
          before release.
        </div>
      )}
      {(old || !online) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 text-sm">
          <CircleAlert className="size-4 text-warn" />
          <span className="flex-1">
            {online ? `This copy was saved ${ago(savedAt)}. The plan may have changed since.` : `Offline copy saved ${ago(savedAt)}. The plan may have changed since.`}
          </span>
          {online && (
            <Button variant="outline" className="h-10 rounded-xl" onClick={fetchLatest} disabled={busy}>
              <ArrowDownToLine className="size-4" /> Fetch latest
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** True once `iso` is older than `ms`; re-evaluated every 30 s. */
function useOlderThan(iso: string | null, ms: number) {
  const [old, setOld] = useState(false);
  useEffect(() => {
    const check = () => setOld(iso ? Date.now() - new Date(iso).getTime() > ms : false);
    check();
    const t = window.setInterval(check, 30_000);
    return () => window.clearInterval(t);
  }, [iso, ms]);
  return old;
}

function StartCard({ m }: { m: ProjectedManifest }) {
  const { scope } = useLoader();
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    try {
      await queueStart(scope, m);
      toast.success("Loading started. Saved on this device and sent automatically.");
    } catch (err) {
      toast.error(err instanceof OfflineStorageError ? err.message : "Could not start loading. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Not started" className="mb-4">
      <p className="text-sm text-muted-foreground">
        Start loading to record line checks. The server accepts it only for the published revision you see (rev {m.planRevision}).
      </p>
      <Button className={cn(bigButton, "mt-3")} onClick={start} disabled={busy || m.revisionMismatch} data-testid="start-loading">
        <Play className="size-5" /> Start loading
      </Button>
    </Section>
  );
}

/** Checklist in physical loading order with batched, queued saves. */
function LoadChecklist({ m, disabled, onReport }: { m: ProjectedManifest; disabled: boolean; onReport: (p: IssuePrefill) => void }) {
  const { scope } = useLoader();
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [saving, setSaving] = useState(false);
  const lines = useMemo(() => new Map(allLines(m).map((x) => [x.line.orderLineId, x])), [m]);
  const ordered = loadingOrder(m.stops);

  const pending = Object.entries(drafts).filter(([, d]) => d.loaded !== null);
  const invalid = pending.some(([id, d]) => {
    const l = lines.get(id);
    return !l || draftErrors(l.line, d).length > 0;
  });

  async function save() {
    if (pending.length === 0 || invalid) return;
    setSaving(true);
    try {
      await queueChecks(
        scope,
        m,
        pending.map(([orderLineId, d]) => ({
          orderLineId,
          loadedUnits: d.loaded!,
          damageUnits: d.damaged,
          ...(d.note.trim() ? { note: d.note.trim() } : {}),
        })),
      );
      setDrafts({});
      toast.success(`${plural(pending.length, "check")} saved on this device. Sent automatically when online.`);
    } catch (err) {
      toast.error(err instanceof OfflineStorageError ? err.message : "Could not save checks. Nothing was saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-ink/20 bg-lime-soft p-3 text-sm" data-testid="loading-rule">
        <p className="font-semibold">Load last delivery first</p>
        <p className="text-muted-foreground">
          The last stop&apos;s goods go in first (deepest in the vehicle) so the first stop&apos;s goods are by the door. This is a simple
          reverse-stop rule, not an optimised warehouse plan; the driver still delivers in forward order.
        </p>
      </div>

      {ordered.map((s) => (
        <StopBlock key={s.stopId} stop={s} total={m.stops.length}>
          {s.orders.map((o) => (
            <div key={o.orderId} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-id font-semibold">{o.orderRef}</span>
                <TempChip temp={o.temp} />
                <span className={cn("text-xs", o.temp === "AMBIENT" ? "text-ambient" : "text-chilled")}>{TEMP_HANDLING[o.temp]}</span>
                {!m.refrigerated && o.temp !== "AMBIENT" && <span className="text-xs font-semibold text-late">Vehicle has no refrigeration</span>}
                <span className="ml-auto text-xs text-muted-foreground">
                  {o.totals.units} units · {kg(o.totals.weightKg)} · {m3(o.totals.volumeM3)}
                </span>
              </div>
              <ul className="space-y-2">
                {o.lines.map((l) => (
                  <LineCheck
                    key={l.orderLineId}
                    line={l}
                    draft={drafts[l.orderLineId]}
                    disabled={disabled}
                    onDraft={(d) =>
                      setDrafts((prev) => {
                        const next = { ...prev };
                        if (d) next[l.orderLineId] = d;
                        else delete next[l.orderLineId];
                        return next;
                      })
                    }
                    onReport={(type, units) => onReport({ type, units, orderId: o.orderId, orderLineId: l.orderLineId })}
                  />
                ))}
              </ul>
            </div>
          ))}
        </StopBlock>
      ))}

      {pending.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 p-3 backdrop-blur" data-testid="save-bar">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <p className="flex-1 text-sm">
              {plural(pending.length, "unsaved check")}
              {invalid && <span className="block text-late">Fix the highlighted lines first</span>}
            </p>
            <Button variant="ghost" className="h-12 rounded-xl" onClick={() => setDrafts({})} disabled={saving}>
              Clear
            </Button>
            <Button className="h-12 rounded-xl px-6 text-base" onClick={save} disabled={saving || invalid} data-testid="save-checks">
              Save checks
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StopBlock({ stop: s, total, children }: { stop: ProjectedStop; total: number; children: React.ReactNode }) {
  const parking = PARKING_LABEL[s.parkingConstraint];
  return (
    <section className="rounded-2xl border bg-card p-4" data-testid="load-stop" data-loading-sequence={s.loadingSequence}>
      <div className="mb-3 flex items-start gap-3">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-ink font-id text-lg font-semibold text-white" aria-label={`Load ${s.loadingSequence} of ${total}`}>
          {s.loadingSequence}
        </div>
        <div className="min-w-0">
          <p className="font-semibold">
            Load {s.loadingSequence} of {total} · delivery stop {s.sequence}
          </p>
          <p className="text-sm text-muted-foreground">
            {s.outletLabel} · window <span className="font-id">{s.windowOpen}–{s.windowClose}</span>
            {parking && <span className="ml-1 font-medium text-warn">· {parking}</span>}
          </p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function DeliveryOrder({ m }: { m: ProjectedManifest }) {
  return (
    <Section title="Delivery order (driver's route)">
      <ol className="space-y-3">
        {m.stops.map((s) => {
          const parking = PARKING_LABEL[s.parkingConstraint];
          return (
            <li key={s.stopId} className="flex gap-3 rounded-xl border p-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-ink font-id font-semibold">{s.sequence}</div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.outletLabel}</p>
                <p className="text-sm text-muted-foreground">
                  Arrive <span className="font-id">{clock(s.plannedArrivalAt)}</span> · window <span className="font-id">{s.windowOpen}–{s.windowClose}</span>
                  {s.mallWindowOpen && (
                    <>
                      {" "}
                      · mall <span className="font-id">{s.mallWindowOpen}–{s.mallWindowClose}</span>
                    </>
                  )}
                  {parking && <span className="font-medium text-warn"> · {parking}</span>}
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {s.orders.map((o) => (
                    <span key={o.orderId} className="inline-flex items-center gap-1 text-xs">
                      <span className="font-id">{o.orderRef}</span> <TempChip temp={o.temp} />
                    </span>
                  ))}
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">loaded {s.loadingSequence === 1 ? "first" : `#${s.loadingSequence}`}</span>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

/** Readiness summary and online-only release. Every disabled condition is spelled out. */
function ReleasePanel({ m, online, onRefreshed }: { m: ProjectedManifest; online: boolean; onRefreshed: () => void }) {
  const { scope } = useLoader();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [serverBlockers, setServerBlockers] = useState<string[] | null>(null);
  const r = m.localReadiness;
  const unsent = m.localEvents.length;

  const blockers = [...r.blockers];
  if (unsent > 0) blockers.push(`${plural(unsent, "action")} on this device not yet confirmed by the server; release waits for them`);
  if (!online) blockers.push("Release needs a connection: the server must confirm the current revision");
  if (m.revisionMismatch) blockers.push("Queued work belongs to an older plan revision; review it on Sync");
  const canTry = blockers.length === 0 && m.state === "LOADING";

  async function release() {
    setBusy(true);
    setServerBlockers(null);
    try {
      // The server copy must be current: release against what the server has, never the local projection.
      const fresh = await fetchManifest(scope, m.id);
      if (fresh.planRevision !== m.planRevision) {
        toast.error(`Plan revised to rev ${fresh.planRevision}. Review the new manifest first.`);
        return;
      }
      await releaseOnline(fresh, newId());
      await fetchManifest(scope, m.id).catch(() => {});
      await qc.invalidateQueries({ queryKey: ["loader"] });
      toast.success(`${m.vehicleId} trip ${m.tripNumber} is ready. The driver can now depart.`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        const details = err.details as { blockers?: string[] } | undefined;
        setServerBlockers(details?.blockers ?? [err.message]);
        toast.error(err.message);
        onRefreshed();
      } else {
        toast.error("Server not reachable. The trip was not released.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Readiness" id="release">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Lines checked" value={`${r.checkedLines}/${r.totalLines}`} tone={r.checkedLines === r.totalLines ? "text-fresh" : undefined} />
        <Stat label="Short" value={r.shortLines} tone={r.shortLines ? "text-late" : undefined} />
        <Stat label="Damaged" value={r.damagedLines} tone={r.damagedLines ? "text-late" : undefined} />
        <Stat label="Blocking issues" value={r.openBlockingIssues} tone={r.openBlockingIssues ? "text-late" : undefined} />
      </dl>
      <p className="mt-3 text-sm text-muted-foreground">
        Plan rev <span className="font-id">{m.planRevision}</span> published {ago(m.planPublishedAt)}
        {m.loadingStartedAt && <> · loading since {clock(m.loadingStartedAt)}</>}
        {m.readyAt && <> · released {clock(m.readyAt)}</>}
      </p>

      {m.state === "READY" ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-lime p-3 font-medium text-ink" data-testid="released">
          <CheckCircle2 className="size-5" /> Released to the driver at {clock(m.readyAt)}. Changing a check sends it back to loading.
        </div>
      ) : blockers.length > 0 ? (
        <div className="mt-4 rounded-xl border border-late/20 bg-late-soft/60 p-3" data-testid="release-blockers">
          <p className="text-sm font-semibold">Release is blocked because:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 rounded-xl bg-lime-soft p-3 text-sm text-fresh">All lines are verified and no blocking issue is open. The server re-checks everything on release.</p>
      )}

      {serverBlockers && (
        <div className="mt-3 rounded-xl border border-late/30 bg-late-soft p-3 text-sm text-late" role="alert">
          <p className="font-semibold">Server refused the release:</p>
          <ul className="list-disc pl-5">
            {serverBlockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {m.state !== "READY" && (
        <Button className={cn(bigButton, "mt-4")} onClick={release} disabled={!canTry || busy} data-testid="mark-ready">
          {busy ? <RefreshCw className="size-5 animate-spin" /> : <CheckCircle2 className="size-5" />} Mark ready for departure
        </Button>
      )}
    </Section>
  );
}

function IssuesPanel({ m, online, canReport, onReport }: { m: ProjectedManifest; online: boolean; canReport: boolean; onReport: () => void }) {
  const [resolving, setResolving] = useState<IssueDto | null>(null);
  return (
    <Section
      title={`Issues (${m.issues.length + m.localIssues.length})`}
      className="mt-4"
      action={
        canReport && (
          <Button variant="outline" className="h-10 rounded-xl" onClick={onReport} data-testid="report-issue">
            Report issue
          </Button>
        )
      }
    >
      {m.issues.length + m.localIssues.length === 0 ? (
        <p className="text-sm text-muted-foreground">No issues on this trip.</p>
      ) : (
        <ul className="space-y-2" data-testid="issue-list">
          {m.localIssues.map((i) => (
            <li key={i.eventId} className="rounded-xl border border-warn/40 bg-warn-soft/50 p-3 text-sm" data-testid="local-issue">
              <div className="flex flex-wrap items-center gap-2">
                <b>{ISSUE_TYPE_LABEL[i.type]}</b> · {SEVERITY_LABEL[i.severity]}
                <span className="ml-auto rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">
                  {i.status === "conflict" || i.status === "blocked" ? "Needs review on Sync" : "Queued · dispatcher not notified yet"}
                </span>
              </div>
              <p className="mt-1">{i.text}</p>
              <p className="text-xs text-muted-foreground">recorded {clock(i.clientAt)} on this device</p>
            </li>
          ))}
          {m.issues.map((i) => {
            const open = i.status !== "RESOLVED";
            const fixable = open && i.blocking && affectedOk(m, i);
            return (
              <li key={i.id} className={cn("rounded-xl border p-3 text-sm", open && i.blocking && "border-late/30")} data-testid="server-issue" data-status={i.status}>
                <div className="flex flex-wrap items-center gap-2">
                  <b>{ISSUE_TYPE_LABEL[i.type]}</b> · {SEVERITY_LABEL[i.severity]}
                  {i.orderRef && <span className="font-id text-xs">{i.orderRef}</span>}
                  {i.blocking && open && <span className="rounded-full bg-late-soft px-2 py-0.5 text-xs font-semibold text-late">Blocks release</span>}
                  <span className={cn("ml-auto rounded-full px-2 py-0.5 text-xs font-semibold", open ? "bg-secondary" : "bg-lime-soft text-fresh")}>
                    {ISSUE_STATUS_LABEL[i.status]}
                  </span>
                </div>
                <p className="mt-1">{i.text}</p>
                <p className="text-xs text-muted-foreground">
                  {i.reporter.name} · {clock(i.createdAt)}
                  {i.resolution && (
                    <>
                      {" "}
                      · resolved by {i.resolvedBy?.name}: {i.resolution}
                    </>
                  )}
                </p>
                {open && i.blocking && (
                  <div className="mt-2">
                    {fixable ? (
                      <Button variant="outline" className="h-10 w-full rounded-xl" onClick={() => setResolving(i)} disabled={!online || m.localEvents.length > 0} data-testid="resolve-issue">
                        Goods corrected · resolve issue
                      </Button>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        To resolve: load and check the affected goods in full (undamaged), or wait for the dispatcher to resolve it.
                      </p>
                    )}
                    {fixable && (!online || m.localEvents.length > 0) && (
                      <p className="mt-1 text-xs text-muted-foreground">Needs a connection and all queued checks sent first.</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ResolveDialog m={m} issue={resolving} onClose={() => setResolving(null)} />
    </Section>
  );
}

/** Are the goods an issue refers to now fully loaded undamaged on the server (current revision)? */
function affectedOk(m: ProjectedManifest, i: IssueDto) {
  const affected = allLines(m).filter(({ line, order }) =>
    i.orderLineId ? line.orderLineId === i.orderLineId : i.orderId ? order.orderId === i.orderId : true,
  );
  return affected.length > 0 && affected.every(({ line }) => !line.local && lineStatus(line, m.planRevision) === "ok");
}

function ResolveDialog({ m, issue, onClose }: { m: ProjectedManifest; issue: IssueDto | null; onClose: () => void }) {
  const { scope } = useLoader();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!issue || !text.trim()) return;
    setBusy(true);
    try {
      const fresh = await fetchManifest(scope, m.id);
      const current = fresh.issues.find((x) => x.id === issue.id);
      if (!current) throw new Error("Issue no longer on this trip");
      await resolveIssueOnline(fresh, current, text.trim(), newId());
      await fetchManifest(scope, m.id).catch(() => {});
      await qc.invalidateQueries({ queryKey: ["loader"] });
      toast.success("Issue resolved. The dispatcher sees the resolution.");
      setText("");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resolve the issue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={issue !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resolve {issue ? ISSUE_TYPE_LABEL[issue.type].toLowerCase() : ""} issue</DialogTitle>
          <DialogDescription>The server checks that the affected goods are now fully loaded and undamaged before closing it.</DialogDescription>
        </DialogHeader>
        <Input
          className="h-11 rounded-xl"
          placeholder="What was done, e.g. 7 crates restocked from cold room 2"
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          aria-label="Resolution"
        />
        <Button className={bigButton} onClick={submit} disabled={busy || !text.trim()} data-testid="resolve-submit">
          Resolve issue
        </Button>
      </DialogContent>
    </Dialog>
  );
}
