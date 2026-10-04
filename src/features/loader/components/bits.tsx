"use client";

import { CheckCircle2, CloudUpload, TriangleAlert } from "lucide-react";
import type { PendingEvent } from "@/lib/offline";
import { cn } from "@/lib/utils";
import type { Temp, TripState } from "@/shared/dto/enums";
import { TRIP_STATE_LABEL } from "../format";
import type { LineState } from "../projection";

const STATE_TONE: Record<TripState, string> = {
  PLANNED: "bg-muted text-muted-foreground",
  LOADING: "bg-warn-soft text-warn",
  READY: "bg-lime text-ink",
  IN_TRANSIT: "bg-ink text-white",
  COMPLETED: "bg-lime-soft text-fresh",
};

export function StateBadge({ state }: { state: TripState }) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold", STATE_TONE[state])} data-testid="trip-state">
      {TRIP_STATE_LABEL[state]}
    </span>
  );
}

const LINE_TONE: Record<LineState, string> = {
  unchecked: "bg-muted text-muted-foreground",
  stale: "bg-warn-soft text-warn",
  short: "bg-late-soft text-late",
  damaged: "bg-late-soft text-late",
  ok: "bg-lime-soft text-fresh",
};
const LINE_LABEL: Record<LineState, string> = {
  unchecked: "Not checked",
  stale: "Re-check (old revision)",
  short: "Short",
  damaged: "Damaged",
  ok: "Loaded",
};

export function LineBadge({ status }: { status: LineState }) {
  return <span className={cn("inline-flex h-6 shrink-0 items-center rounded-full px-2 text-xs font-semibold", LINE_TONE[status])}>{LINE_LABEL[status]}</span>;
}

/** Local (queued) vs confirmed (server-acknowledged) progress, always labelled apart. */
export function SyncBadge({ events }: { events: PendingEvent[] }) {
  if (events.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-fresh">
        <CheckCircle2 className="size-3.5" /> Confirmed by server
      </span>
    );
  }
  if (events.some((e) => e.status === "conflict" || e.status === "blocked")) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-late">
        <TriangleAlert className="size-3.5" /> Needs attention
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-warn">
      <CloudUpload className="size-3.5" /> {events.length} queued on this device
    </span>
  );
}

const TEMP_TONE: Record<Temp, string> = {
  AMBIENT: "border-ambient/40 text-ambient",
  CHILLED: "border-chilled/40 text-chilled",
  FROZEN: "border-chilled/40 text-chilled",
};

export function TempChip({ temp }: { temp: Temp }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded border px-1.5 text-[11px] font-semibold uppercase", TEMP_TONE[temp])}>
      {temp.toLowerCase()}
    </span>
  );
}

export function Section({
  title,
  action,
  children,
  className,
  id,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("rounded-2xl border bg-card p-4", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Large tap target for tablet/phone use. */
export const bigButton = "h-12 w-full rounded-xl text-base";

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl bg-secondary p-3 text-center">
      <dd className={cn("font-id text-2xl font-semibold", tone)}>{value}</dd>
      <dt className="text-xs text-muted-foreground">{label}</dt>
    </div>
  );
}
