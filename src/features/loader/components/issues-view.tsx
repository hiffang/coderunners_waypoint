"use client";

import { useState } from "react";
import { LoadingScreen } from "@/components/loading-screen";
import { cn } from "@/lib/utils";
import { clock, dayLabel, ISSUE_STATUS_LABEL, ISSUE_TYPE_LABEL, SEVERITY_LABEL, TRIP_STATE_LABEL } from "../format";
import { useIssueList } from "../hooks";
import { LoaderLink } from "../session";
import { RefreshError } from "./states";
import { StatusStrip } from "./status-strip";

/** /loader/issues: shortfall/damage and other issues on this depot's trips, with what the dispatcher has done. */
export function IssuesView() {
  const { stored, refresh } = useIssueList();
  const [showResolved, setShowResolved] = useState(false);
  const items = stored?.data.items ?? [];
  const open = items.filter((i) => i.status !== "RESOLVED");
  const shown = showResolved ? items : open;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Issues</h1>
        <p className="text-sm text-muted-foreground">Loading issues on your depot&apos;s trips. Queued reports appear on their trip until the server confirms them.</p>
      </header>
      <StatusStrip />
      <RefreshError error={refresh.error} />

      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1" role="tablist">
        {([false, true] as const).map((v) => (
          <button
            key={String(v)}
            role="tab"
            aria-selected={showResolved === v}
            className={cn("h-10 rounded-lg text-sm font-medium", showResolved === v ? "bg-card shadow-sm" : "text-muted-foreground")}
            onClick={() => setShowResolved(v)}
          >
            {v ? `All (${items.length})` : `Open (${open.length})`}
          </button>
        ))}
      </div>

      {stored === undefined || (stored === null && refresh.isPending) ? (
        <LoadingScreen portal="loader" title="Loading depot issues" />
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground" data-testid="no-issues">
          {stored ? (showResolved ? "No issues in the last 7 days." : "No open issues.") : "Connect to the network to load issues."}
        </div>
      ) : (
        <ul className="space-y-3" data-testid="depot-issues">
          {shown.map((i) => (
            <li key={i.id}>
              <LoaderLink href={`/loader/trips/${i.trip.id}`} className="block rounded-2xl border bg-card p-4 hover:border-ink/40">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <b>{ISSUE_TYPE_LABEL[i.type]}</b> · {SEVERITY_LABEL[i.severity]}
                  {i.blocking && i.status !== "RESOLVED" && (
                    <span className="rounded-full bg-late-soft px-2 py-0.5 text-xs font-semibold text-late">Blocks release</span>
                  )}
                  <span className={cn("ml-auto rounded-full px-2 py-0.5 text-xs font-semibold", i.status === "RESOLVED" ? "bg-lime-soft text-fresh" : "bg-secondary")}>
                    {ISSUE_STATUS_LABEL[i.status]}
                  </span>
                </div>
                <p className="mt-1 text-sm">{i.text}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-id">{i.trip.vehicleId}</span> trip {i.trip.tripNumber} · {dayLabel(i.trip.serviceDate)} ·{" "}
                  {TRIP_STATE_LABEL[i.trip.state].toLowerCase()}
                  {i.orderRef && (
                    <>
                      {" "}
                      · <span className="font-id">{i.orderRef}</span>
                    </>
                  )}{" "}
                  · {i.reporter.name} {clock(i.createdAt)}
                </p>
                {i.resolution && (
                  <p className="mt-1 text-xs">
                    Resolved by {i.resolvedBy?.name}: {i.resolution}
                  </p>
                )}
              </LoaderLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
