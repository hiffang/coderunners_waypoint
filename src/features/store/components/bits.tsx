"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { AlertCircle, PackageOpen, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingScreen } from "@/components/loading-screen";
import type { OrderDto } from "@/shared/dto/order";

export const label = (value: string) =>
  value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
export function instant(value?: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Colombo",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "Not recorded";
}
export function date(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${value}T00:00:00Z`));
}
export function Status({ value }: { value: string }) {
  return (
    <Badge
      className={
        value === "DEFERRED" ||
        value === "DISPUTED" ||
        value === "PARTIALLY_DELIVERED"
          ? "bg-warn-soft text-warn"
          : value === "RECEIVED" || value === "RESOLVED"
            ? "bg-lime-soft text-ink"
            : "bg-secondary text-foreground"
      }
    >
      {value === "CONFIRMED" ? "Order accepted" : label(value)}
    </Badge>
  );
}
export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="space-y-4 p-5">{children}</CardContent>
    </Card>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border border-warn/20 bg-warn-soft p-4 text-sm">
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-warn" />
      <div>{children}</div>
    </div>
  );
}
export function Failure({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border bg-card p-6">
      <h2 className="font-semibold">Unable to load this page</h2>
      <p className="my-3 text-sm text-late">{error.message}</p>
      <Button variant="outline" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}
export function Loading() {
  return <LoadingScreen portal="store" title="Loading your store" description="Preparing your orders and delivery details." />;
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed bg-card px-6 py-12 text-center">
      <PackageOpen className="mx-auto mb-3 size-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
export function Heading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Store portal
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Refresh({
  at,
  refresh,
  busy,
}: {
  at: number;
  refresh: () => void;
  busy?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span>
        Last refreshed {at ? instant(new Date(at).toISOString()) : "—"} · Sri
        Lanka time
      </span>
      <Button variant="ghost" size="sm" onClick={refresh} disabled={busy}>
        <RefreshCw className={busy ? "animate-spin" : ""} />
        Refresh
      </Button>
    </div>
  );
}
export function OrderLink({ order }: { order: OrderDto }) {
  return (
    <Link
      className="font-id font-medium underline-offset-4 hover:underline"
      href={`/store/orders/${order.id}`}
    >
      {order.orderRef}
    </Link>
  );
}
export function Arrival({ order }: { order: OrderDto }) {
  return (
    <>
      {order.deferral
        ? `Next eligible run: ${date(order.deferral.nextEligibleDate)}`
        : order.allocation
          ? `${order.allocation.etaAt ? "ETA" : "Scheduled"}: ${instant(order.allocation.etaAt ?? order.allocation.plannedArrivalAt)}`
          : "Not scheduled"}
    </>
  );
}
export function Back({ id }: { id?: string }) {
  return (
    <Link
      className="text-sm text-muted-foreground hover:underline"
      href={id ? `/store/orders/${id}` : "/store"}
    >
      ← {id ? "Order details" : "All orders"}
    </Link>
  );
}
