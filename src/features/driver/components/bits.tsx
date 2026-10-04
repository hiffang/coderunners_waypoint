"use client";

import { CheckCircle2, CloudUpload, TriangleAlert } from "lucide-react";
import type { PendingEvent } from "@/lib/offline";
import { cn } from "@/lib/utils";
import type { StopState, Temp, TripState } from "@/shared/dto/enums";
import { STOP_STATE_LABEL, TRIP_STATE_LABEL } from "../format";

const STATE_TONE: Record<string, string> = {
  PLANNED: "bg-muted text-muted-foreground",
  LOADING: "bg-warn-soft text-warn",
  READY: "bg-lime text-ink",
  IN_TRANSIT: "bg-ink text-white",
  COMPLETED: "bg-lime-soft text-fresh",
  PENDING: "bg-muted text-muted-foreground",
  ARRIVED: "bg-ink text-white",
  DELIVERED: "bg-lime-soft text-fresh",
  PARTIAL: "bg-warn-soft text-warn",
  FAILED: "bg-late-soft text-late",
};

export function StateBadge({ state, kind }: { state: TripState | StopState; kind: "trip" | "stop" }) {
  const label = kind === "trip" ? TRIP_STATE_LABEL[state as TripState] : STOP_STATE_LABEL[state as StopState];
  return <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold", STATE_TONE[state])}>{label}</span>;
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
      <CloudUpload className="size-3.5" /> Saved on phone · not sent yet
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

export function Section({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border bg-card p-4", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Large tap target for phone use. */
export const bigButton = "h-12 w-full rounded-xl text-base";
