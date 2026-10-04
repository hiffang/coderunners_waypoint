"use client";

import { CloudOff, KeyRound, RefreshCw, TriangleAlert, UserX } from "lucide-react";
import { useNavigatorOnline, useSyncState } from "@/lib/offline";
import { cn } from "@/lib/utils";
import { ago, plural } from "../format";
import { LoaderLink, useLoader } from "../session";

/**
 * Always-visible connection + outbox summary. "Saved on this device" and
 * "confirmed by server" are never merged into one number.
 */
export function StatusStrip() {
  const { scope } = useLoader();
  const online = useNavigatorOnline();
  const state = useSyncState(scope);
  if (!state) return null;
  const unsent = state.pending + state.sending;
  const attention = state.conflict + state.blocked;

  let tone = "bg-card";
  let icon = <RefreshCw className={cn("size-4", state.syncing && "animate-spin")} />;
  let text: React.ReactNode = state.lastSuccessAt ? `All synced · last sync ${ago(state.lastSuccessAt)}` : "Connected";

  if (state.paused === "auth") {
    tone = "bg-warn-soft";
    icon = <KeyRound className="size-4 text-warn" />;
    text = `Session expired. ${plural(unsent, "saved action")} wait for you to sign in again.`;
  } else if (state.paused === "account") {
    tone = "bg-late-soft";
    icon = <UserX className="size-4 text-late" />;
    text = "Another account is signed in on this device. Your saved work is kept but not sent.";
  } else if (!online || state.lastNetworkError) {
    tone = "bg-warn-soft";
    icon = <CloudOff className="size-4 text-warn" />;
    text = unsent > 0 ? `Offline · ${plural(unsent, "action")} saved on this device` : "Offline · showing downloaded manifests";
  } else if (unsent > 0) {
    text = `${state.syncing ? "Sending" : "Waiting to send"} ${plural(unsent, "action")}`;
  }

  return (
    <div className="mb-4 space-y-2" data-testid="status-strip">
      <LoaderLink href="/loader/sync" className={cn("flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-sm", tone)}>
        {icon}
        <span className="flex-1">{text}</span>
        {unsent > 0 && <span className="rounded-full bg-ink px-2 py-0.5 font-id text-xs text-white">{unsent}</span>}
      </LoaderLink>
      {attention > 0 && (
        <LoaderLink
          href="/loader/sync"
          className="flex min-h-11 items-center gap-2 rounded-xl border border-late/30 bg-late-soft px-3 py-2 text-sm font-medium text-late"
        >
          <TriangleAlert className="size-4" />
          {attention} action{attention === 1 ? " needs" : "s need"} your review · open Sync
        </LoaderLink>
      )}
    </div>
  );
}
