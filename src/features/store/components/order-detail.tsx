"use client";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cancelOrderSchema,
  type CancelOrderInput,
  type OrderDto,
} from "@/shared/dto/order";
import { useStoreCommand, useStoreOrder } from "../hooks";
import { canReceive } from "../rules";
import {
  Arrival,
  Back,
  date,
  Failure,
  Heading,
  instant,
  Loading,
  Notice,
  Panel,
  Refresh,
  Status,
} from "./bits";
import { LineTable } from "./receipt-view";
import { IssueHistory } from "./issue-view";

export function OrderDetail({ id }: { id: string }) {
  const query = useStoreOrder(id);
  if (query.isPending) return <Loading />;
  if (query.error && !query.data)
    return <Failure error={query.error} retry={() => query.refetch()} />;
  if (!query.data) return null;
  const { order: o, editable, issues } = query.data;
  const stages = [
    { title: "Order accepted", at: o.submittedAt },
    {
      title: "Allocated",
      at:
        o.allocation && !o.deferral
          ? `${date(o.allocation.serviceDate)} · ${o.allocation.vehicleId}`
          : null,
    },
    { title: "Driver delivered", at: o.delivery?.submittedAt },
    {
      title:
        o.receipt?.status === "DISPUTED"
          ? "Receipt disputed"
          : "Store received",
      at: o.receipt?.receivedAt,
    },
  ];
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Back />
      <Heading
        title={o.orderRef}
        description={`${o.outletLabel} · ${o.temp.toLowerCase()} order`}
        action={
          <div className="flex flex-wrap gap-2">
            {editable && (
              <Link
                className={buttonVariants({ variant: "outline" })}
                href={`/store/orders/${id}/edit`}
              >
                Edit order
              </Link>
            )}
            {canReceive(o) && (
              <Link
                className={buttonVariants({ className: "bg-lime text-ink" })}
                href={`/store/orders/${id}/receipt`}
              >
                Confirm receipt
              </Link>
            )}
            <Link
              className={buttonVariants({ variant: "outline" })}
              href={`/store/orders/${id}/issues`}
            >
              Report issue
            </Link>
          </div>
        }
      />
      <Refresh
        at={query.dataUpdatedAt}
        refresh={() => query.refetch()}
        busy={query.isFetching}
      />
      {query.isRefetchError && (
        <Notice>
          Refresh failed. These details may have changed. Retry before acting.
        </Notice>
      )}
      {o.deferral && (
        <Notice>
          <strong>Delivery deferred: {o.deferral.reasonText}</strong>
          <p className="mt-1">
            Missed run {date(o.deferral.serviceDate)}. Next eligible run{" "}
            {date(o.deferral.nextEligibleDate)}. {o.priorDeferrals.length} prior
            deferred run(s). An arrival time will appear when scheduled.
          </p>
        </Notice>
      )}
      {o.status === "PARTIALLY_DELIVERED" && (
        <Notice>
          Only part of this order was delivered. Confirm the actual quantities
          below. Place a separate replacement order for any missing goods.
        </Notice>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <Panel>
          <p className="text-sm text-muted-foreground">Order status</p>
          <Status value={o.status} />
          <p className="text-xs text-muted-foreground">Version {o.version}</p>
        </Panel>
        <Panel>
          <p className="text-sm text-muted-foreground">Delivery run</p>
          <p className="font-semibold">{date(o.eligibleServiceDate)}</p>
          <p className="text-xs text-muted-foreground">
            Requested {date(o.requestedDate)}
          </p>
        </Panel>
        <Panel>
          <p className="text-sm text-muted-foreground">Expected arrival</p>
          <p className="font-semibold">
            <Arrival order={o} />
          </p>
          <p className="text-xs text-muted-foreground">
            {o.allocation && !o.deferral
              ? `Vehicle ${o.allocation.vehicleId} · Trip ${o.allocation.tripNumber} · Stop ${o.allocation.stopSequence}`
              : "Awaiting a published delivery plan"}
          </p>
        </Panel>
      </div>
      <Panel>
        <h2 className="font-semibold">Order progress</h2>
        <ol className="grid gap-3 sm:grid-cols-4">
          {stages.map((s, i) => (
            <li
              key={s.title}
              className={`rounded-xl border p-4 ${s.at ? "bg-lime-soft" : "bg-secondary"}`}
            >
              <p className="mb-2 text-xs text-muted-foreground">0{i + 1}</p>
              <p className="text-sm font-semibold">{s.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {s.at
                  ? i === 1
                    ? s.at
                    : instant(s.at)
                  : o.status === "CANCELLED"
                    ? "Cancelled"
                    : "Pending"}
              </p>
            </li>
          ))}
        </ol>
      </Panel>
      <Panel>
        <h2 className="font-semibold">Goods and quantities</h2>
        <LineTable order={o} />
        <p className="text-sm text-muted-foreground">
          Server totals: {o.totals.units} units · {o.totals.weightKg.toFixed(2)}{" "}
          kg · {o.totals.volumeM3.toFixed(3)} m³
        </p>
      </Panel>
      <Panel>
        <h2 className="font-semibold">Delivery record & evidence</h2>
        {o.delivery?.submittedAt ? (
          <>
            <p className="text-sm">
              {o.delivery.outcome} · Recorded {instant(o.delivery.submittedAt)}{" "}
              · Recipient {o.delivery.recipientName ?? "Not supplied"}
            </p>
            {o.delivery.failureReason && (
              <Notice>{o.delivery.failureReason}</Notice>
            )}
            <div className="flex flex-wrap gap-3">
              {o.delivery.evidence.map((f, i) => (
                <a
                  key={f.id}
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm underline"
                >
                  View delivery evidence {i + 1}
                </a>
              ))}
            </div>
            {!o.delivery.evidence.length && (
              <p className="text-sm text-muted-foreground">
                No delivery images attached.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Delivery has not been synchronized. Receipt confirmation is
            available after the driver submits the delivery.
          </p>
        )}
      </Panel>
      {o.receipt && (
        <Panel>
          <h2 className="font-semibold">Store receipt</h2>
          <Status
            value={o.receipt.status === "CONFIRMED" ? "RECEIVED" : "DISPUTED"}
          />
          <p className="text-sm">Recorded {instant(o.receipt.receivedAt)}</p>
          {o.receipt.note && (
            <p className="text-sm whitespace-pre-wrap">{o.receipt.note}</p>
          )}
          <Link
            href={`/store/orders/${id}/receipt`}
            className="text-sm underline"
          >
            View receipt
          </Link>
        </Panel>
      )}
      <Panel>
        <h2 className="font-semibold">Issue history</h2>
        <IssueHistory issues={issues} />
      </Panel>
      {editable && <CancelForm order={o} />}
    </div>
  );
}
function CancelForm({ order }: { order: OrderDto }) {
  const command = useStoreCommand<OrderDto>();
  const form = useForm<CancelOrderInput>({
    resolver: zodResolver(cancelOrderSchema),
    defaultValues: { expectedVersion: order.version, reason: "" },
  });
  return (
    <Panel>
      <h2 className="font-semibold">Cancel this order</h2>
      <p className="text-sm text-muted-foreground">
        Available before cutoff and allocation. Cancellation is recorded with
        your reason.
      </p>
      <form
        className="space-y-3"
        onSubmit={form.handleSubmit(async (values) => {
          const result = await command.execute(
            `/api/store/orders/${order.id}/cancel`,
            { ...values, expectedVersion: order.version },
          );
          if (result) toast.success("Order cancelled");
        })}
      >
        <Label htmlFor="cancel-reason">Cancellation reason</Label>
        <Input
          id="cancel-reason"
          {...form.register("reason")}
          aria-invalid={Boolean(form.formState.errors.reason)}
        />
        <p className="text-sm text-late">
          {form.formState.errors.reason?.message}
        </p>
        {command.error && (
          <p role="alert" className="text-sm text-late">
            {command.error}
          </p>
        )}
        <Button
          type="submit"
          variant="destructive"
          disabled={command.isPending}
        >
          {command.isPending ? "Cancelling…" : "Cancel order"}
        </Button>
      </form>
    </Panel>
  );
}
