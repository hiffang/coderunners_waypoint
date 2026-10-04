"use client";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";
export const label = (s: string) => s.toLowerCase().replaceAll("_", " ");
export const time = (s: string | null) =>
  s
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Colombo",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(s))
    : "—";
export function Panel({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border bg-card">
      {title && (
        <h2 className="border-b px-5 py-4 text-base font-semibold">{title}</h2>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
export function Status({
  children,
  warn = false,
}: {
  children: ReactNode;
  warn?: boolean;
}) {
  return (
    <span
      className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${warn ? "bg-warn-soft text-foreground" : "bg-secondary"}`}
    >
      {children}
    </span>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>
  );
}
export function Failure({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border bg-late-soft p-5">
      <p>{error.message}</p>
      <Button className="mt-3 min-h-11" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}
export function Capacity({
  label: title,
  value,
  max,
  unit,
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between gap-2 text-xs">
        <span>{title}</span>
        <span className="font-id">
          {value.toFixed(unit === "m³" ? 2 : 1)} /{" "}
          {max.toFixed(unit === "m³" ? 2 : 1)} {unit}
        </span>
      </div>
      <div
        role="meter"
        aria-label={title}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={`h-full ${value > max ? "bg-late" : "bg-ink"}`}
          style={{ width: `${Math.min(100, max ? (value / max) * 100 : 0)}%` }}
        />
      </div>
    </div>
  );
}
