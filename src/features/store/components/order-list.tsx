"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ORDER_STATUSES } from "@/shared/dto/enums";
import { outletLabel } from "@/shared/dto/reference";
import { canReceive } from "../rules";
import { useStoreOrders, useStoreReference, useStoreMe } from "../hooks";
import {
  Arrival,
  date,
  Empty,
  Failure,
  Heading,
  instant,
  label,
  Loading,
  Notice,
  OrderLink,
  Panel,
  Refresh,
  Status,
} from "./bits";

export function OrderList({
  mode = "orders",
}: {
  mode?: "orders" | "deliveries" | "receipts";
}) {
  const query = useStoreOrders();
  const reference = useStoreReference();
  const me = useStoreMe();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [serviceDate, setServiceDate] = useState("");
  if (query.isPending || reference.isPending) return <Loading />;
  if (query.error)
    return <Failure error={query.error} retry={() => query.refetch()} />;
  if (reference.error)
    return (
      <Failure error={reference.error} retry={() => reference.refetch()} />
    );
  const all = query.data.pages
    .flatMap((p) => p.items)
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));
  const outlet = reference.data.outlets[0];
  const pending = all.filter(canReceive);
  const deferred = all.filter((o) => o.deferral && o.status === "DEFERRED");
  const expected = all
    .filter(
      (o) =>
        o.allocation &&
        !o.deferral &&
        !["DELIVERED", "PARTIALLY_DELIVERED", "RECEIVED", "CANCELLED"].includes(
          o.status,
        ),
    )
    .sort((a, b) =>
      a.allocation!.plannedArrivalAt.localeCompare(
        b.allocation!.plannedArrivalAt,
      ),
    )[0];
  const items = all.filter(
    (o) =>
      (mode === "orders" ||
        (mode === "receipts"
          ? canReceive(o) || Boolean(o.receipt)
          : Boolean(o.allocation || o.deferral))) &&
      (!status || o.status === status) &&
      (!serviceDate || o.eligibleServiceDate === serviceDate) &&
      `${o.orderRef} ${o.lines.map((l) => l.description).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const cutoffClosed = me.data
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: me.data.timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(me.data.serverTime)) >= reference.data.cutoff.localTime
    : false;
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Heading
        title={label(mode)}
        description={
          outlet
            ? `${outletLabel(outlet)} · ${outlet.depotName} depot`
            : "Your authorized outlet"
        }
        action={
          <Link
            className={buttonVariants({
              className: "bg-lime text-ink hover:bg-lime/80",
              size: "lg",
            })}
            href="/store/orders/new"
          >
            <Plus className="size-4" />
            New order
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Panel>
          <p className="text-sm text-muted-foreground">Next expected arrival</p>
          <p className="text-lg font-semibold">
            {expected
              ? instant(
                  expected.allocation!.etaAt ??
                    expected.allocation!.plannedArrivalAt,
                )
              : "Not scheduled"}
          </p>
          {expected ? (
            <OrderLink order={expected} />
          ) : (
            <p className="text-xs text-muted-foreground">
              Arrival appears after allocation.
            </p>
          )}
        </Panel>
        <Panel>
          <p className="text-sm text-muted-foreground">
            Pending store receipts
          </p>
          <p className="text-3xl font-semibold">{pending.length}</p>
          <Link className="text-sm underline" href="/store/receipts">
            Review delivered orders
          </Link>
        </Panel>
        <Panel>
          <p className="text-sm text-muted-foreground">
            Order cutoff · Sri Lanka
          </p>
          <p className="font-id text-3xl font-semibold">
            {reference.data.cutoff.localTime}
          </p>
          <p className="text-xs text-muted-foreground">
            Earliest eligible run:{" "}
            {date(reference.data.cutoff.earliestEligibleDate)}
          </p>
          {me.data?.demoClock && <Status value="DEMO_CLOCK" />}
        </Panel>
      </div>
      {cutoffClosed && (
        <Notice>
          Cutoff has passed. New orders can join the{" "}
          {date(reference.data.cutoff.earliestEligibleDate)} run or a later
          operating day.
        </Notice>
      )}
      {deferred.length > 0 && (
        <Notice>
          {deferred.length} order{deferred.length === 1 ? " is" : "s are"}{" "}
          deferred. Open an order for the reason and next eligible run.
        </Notice>
      )}
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">
            {mode === "receipts"
              ? "Confirm what arrived"
              : mode === "deliveries"
                ? "Delivery tracking"
                : "Order history"}
          </h2>
          <Refresh
            at={query.dataUpdatedAt}
            busy={query.isFetching}
            refresh={() => {
              query.refetch();
              reference.refetch();
              me.refetch();
            }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            aria-label="Search orders"
            placeholder="Search reference or goods…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            aria-label="Filter status"
            className="h-9 rounded-lg border bg-background px-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === "CONFIRMED" ? "Order accepted" : label(s)}
              </option>
            ))}
          </select>
          <Input
            aria-label="Filter service date"
            type="date"
            value={serviceDate}
            onChange={(e) => setServiceDate(e.target.value)}
          />
        </div>
        {items.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Service date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Goods</TableHead>
                <TableHead>Arrival / receipt</TableHead>
                <TableHead>
                  <span className="sr-only">Action</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <OrderLink order={o} />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {label(o.temp)} · {instant(o.submittedAt)}
                    </p>
                  </TableCell>
                  <TableCell>{date(o.eligibleServiceDate)}</TableCell>
                  <TableCell>
                    <Status value={o.status} />
                    {o.receipt && (
                      <div className="mt-1">
                        <Status
                          value={
                            o.receipt.status === "CONFIRMED"
                              ? "RECEIVED"
                              : "DISPUTED"
                          }
                        />
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {o.totals.units} units
                    <p className="text-xs text-muted-foreground">
                      {o.totals.weightKg.toFixed(2)} kg ·{" "}
                      {o.totals.volumeM3.toFixed(3)} m³
                    </p>
                  </TableCell>
                  <TableCell>
                    <Arrival order={o} />
                    {o.deferral && (
                      <p className="max-w-64 whitespace-normal text-xs text-warn">
                        {o.deferral.reasonText}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      aria-label={`${canReceive(o) ? "Confirm receipt for" : "View"} ${o.orderRef}`}
                      className="inline-flex items-center gap-1 text-sm font-medium underline"
                      href={`/store/orders/${o.id}${canReceive(o) ? "/receipt" : ""}`}
                    >
                      {canReceive(o) ? "Receive" : "View"}
                      <ArrowUpRight className="size-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Empty>
            {all.length
              ? "No orders match these filters."
              : "No orders yet. Create your first order to request a delivery."}
          </Empty>
        )}
        {query.hasNextPage && (
          <Button
            variant="outline"
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
          >
            Load more orders
          </Button>
        )}
        {query.isRefetchError && (
          <p role="alert" className="text-sm text-late">
            Refresh failed. Showing the last loaded data.
          </p>
        )}
      </Panel>
    </div>
  );
}
