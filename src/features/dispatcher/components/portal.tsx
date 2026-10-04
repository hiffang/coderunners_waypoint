"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowUpRight,
  RefreshCw,
  Truck,
  Package,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  resolveIssueSchema,
  type IssueDto,
  type ResolveIssueInput,
} from "@/shared/dto/issue";
import {
  deferOrderSchema,
  type DeferOrderInput,
  type OrderDto,
} from "@/shared/dto/order";
import type { PlanSummaryDto } from "@/shared/dto/plan";
import type { ManifestDto } from "@/shared/dto/manifest";
import { useDispatcher, useDispatcherMutation } from "../hooks";
import { Capacity, Empty, Failure, label, Panel, Status, time } from "./bits";

export type View =
  | "overview"
  | "orders"
  | "routes"
  | "deferrals"
  | "monitor"
  | "loading-bays"
  | "reports"
  | "fleet";
const titles: Record<View, string> = {
  overview: "Your depot, at a glance.",
  orders: "Order queue",
  routes: "Route planning",
  deferrals: "Every missed run, explained.",
  monitor: "Delivery monitor",
  "loading-bays": "Loading bays",
  reports: "Service report",
  fleet: "Fleet & capacity",
};
export function DispatcherPortal({
  initialDate,
  view = "overview",
}: {
  initialDate: string;
  view?: View;
}) {
  const [date, setDate] = useState(initialDate);
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [temp, setTemp] = useState("");
  const [district, setDistrict] = useState("");
  const [access, setAccess] = useState("");
  const { monitor, plans, reference, me } = useDispatcher(date);
  const mutation = useDispatcherMutation<PlanSummaryDto>();
  const router = useRouter();
  const refresh = () => {
    void monitor.refetch();
    void plans.refetch();
    void reference.refetch();
  };
  const error = monitor.error ?? plans.error ?? reference.error ?? me.error;
  const data = monitor.data;
  const orders = data?.orders ?? [];
  const queue = orders.filter(
    (o) =>
      ["CONFIRMED", "DEFERRED"].includes(o.status) &&
      o.eligibleServiceDate <= date,
  );
  const trips = data?.trips ?? [];
  const issues = data?.issues ?? [];
  const filtered = (view === "orders" ? queue : orders).filter(
    (o) =>
      `${o.orderRef} ${o.outletLabel}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!brand || o.brand === brand) &&
      (!temp || o.temp === temp) &&
      (!district || o.district === district) &&
      (view !== "deferrals" ||
        o.priorDeferrals.length > 0 ||
        o.status === "DEFERRED" ||
        o.delivery?.outcome === "FAILED") &&
      (!access ||
        reference.data?.outlets.find((x) => x.id === o.outletId)
          ?.parkingConstraint === access),
  );
  const plan = plans.data?.items[0];
  const stale = monitor.isError || monitor.fetchStatus === "paused";
  const create = async () => {
    if (!me.data?.depotId) return;
    const p = await mutation.mutateAsync({
      path: "plans",
      body: { depotId: me.data.depotId, serviceDate: date },
    });
    router.push(`/dispatcher/plans/${p.id}`);
  };
  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">
            {me.data?.depotName ?? "Dispatcher"} · Asia/Colombo
            {me.data?.demoClock ? " · Demo clock" : ""}
          </p>
          <h1 className="text-3xl font-bold tracking-tight">{titles[view]}</h1>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium">
            Service date
            <Input
              className="mt-1 min-h-11 w-40 bg-card"
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </label>
          <Button
            variant="outline"
            className="min-h-11 bg-card"
            onClick={refresh}
            disabled={monitor.isFetching}
          >
            <RefreshCw className="size-4" /> Refresh
          </Button>
          {plan ? (
            <Link
              className={`${buttonVariants()} min-h-11 bg-lime text-ink hover:bg-lime/80`}
              href={`/dispatcher/plans/${plan.id}`}
            >
              Open plan <ArrowUpRight />
            </Link>
          ) : (
            <Button
              className="min-h-11 bg-lime text-ink hover:bg-lime/80"
              disabled={mutation.isPending || !me.data || !!error}
              onClick={() => void create().catch(() => {})}
            >
              {mutation.isPending ? "Creating…" : "Create plan"}
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-y py-3 text-xs text-muted-foreground">
        <span>Order cutoff: 16:00 on the preceding operating day</span>
        <span role="status">
          {stale
            ? "Updates unavailable — showing the last received data"
            : data
              ? `Last refreshed ${time(data.serverTime)} · refreshes every 10 seconds`
              : "Loading depot data…"}
        </span>
      </div>
      {error && <Failure error={error} retry={refresh} />}
      {!data && !error && (
        <div
          className="h-64 animate-pulse rounded-xl bg-card motion-reduce:animate-none"
          aria-label="Loading dispatcher portal"
        />
      )}
      {data && (
        <>
          {["overview", "reports"].includes(view) && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  title: "Delivered orders",
                  value: orders.filter((o) =>
                    ["DELIVERED", "RECEIVED"].includes(o.status),
                  ).length,
                  icon: CheckCircle2,
                  detail: `${orders.filter((o) => o.status === "PARTIALLY_DELIVERED").length} partially delivered`,
                },
                {
                  title: "Vehicles on the road",
                  value: new Set(
                    trips
                      .filter((t) => t.state === "IN_TRANSIT")
                      .map((t) => t.vehicleId),
                  ).size,
                  icon: Truck,
                  detail: `${trips.length} published trips`,
                },
                {
                  title: "Orders awaiting planning",
                  value: queue.length,
                  icon: Package,
                  detail: `${queue.filter((o) => o.temp === "CHILLED").length} chilled orders`,
                },
                {
                  title: "Open exceptions",
                  value: issues.length,
                  icon: AlertTriangle,
                  detail: `${issues.filter((i) => i.blocking).length} blocking loading`,
                },
              ].map((k) => (
                <Panel key={k.title}>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    {k.title}
                    <k.icon className="size-4" />
                  </div>
                  <p className="my-3 text-4xl font-semibold tabular-nums">
                    {k.value}
                  </p>
                  <p className="text-xs text-muted-foreground">{k.detail}</p>
                </Panel>
              ))}
            </div>
          )}
          {view === "routes" && (
            <Panel title="Plans for this service date">
              {plan ? (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <Status>
                      {label(plan.status)} · revision {plan.revision}
                    </Status>
                    <p className="mt-3">
                      {plan.counts.served} served · {plan.counts.deferred}{" "}
                      deferred · {plan.counts.undecided} undecided
                    </p>
                  </div>
                  <Link
                    className={`${buttonVariants()} min-h-11`}
                    href={`/dispatcher/plans/${plan.id}`}
                  >
                    Continue planning <ArrowUpRight />
                  </Link>
                </div>
              ) : (
                <Empty>
                  No plan yet. Create a plan to assign this day’s eligible
                  orders.
                </Empty>
              )}
            </Panel>
          )}
          {["overview", "monitor", "loading-bays", "routes"].includes(view) && (
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
              <Panel
                title={
                  view === "loading-bays"
                    ? "Warehouse progress"
                    : "Trips & delivery progress"
                }
              >
                <div className="space-y-4">
                  {trips
                    .filter(
                      (t) =>
                        view !== "loading-bays" ||
                        ["PLANNED", "LOADING", "READY"].includes(t.state),
                    )
                    .map((t) => (
                      <TripCard
                        key={t.id}
                        trip={t}
                        orders={orders}
                        loading={view === "loading-bays"}
                      />
                    ))}
                  {!trips.length && (
                    <Empty>
                      Published trips will appear here. Start with route
                      planning.
                    </Empty>
                  )}
                </div>
              </Panel>
              <div className="space-y-5">
                <Panel title="Needs your attention">
                  {issues.length ? (
                    issues.map((i) => (
                      <IssueCard key={`${i.id}-${i.version}`} issue={i} />
                    ))
                  ) : (
                    <Empty>No open exceptions at this depot.</Empty>
                  )}
                </Panel>
                <Panel title="Available fleet">
                  <p className="text-3xl font-semibold">
                    {reference.data?.vehicles.filter(
                      (v) => v.status === "AVAILABLE",
                    ).length ?? "—"}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Depot vehicles available for planning
                  </p>
                  <Link
                    href={`/dispatcher/fleet?serviceDate=${date}`}
                    className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm underline"
                  >
                    View fleet capacity <ArrowUpRight className="size-4" />
                  </Link>
                </Panel>
              </div>
            </div>
          )}
          {["orders", "deferrals"].includes(view) && (
            <Panel
              title={
                view === "orders"
                  ? `${queue.length} eligible orders · whole orders only`
                  : "Deferral history & recovery"
              }
            >
              <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <label className="text-xs">
                  Find an order
                  <Input
                    className="mt-1 min-h-11"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Order or outlet"
                  />
                </label>
                {[
                  {
                    name: "Brand",
                    value: brand,
                    set: setBrand,
                    options: ["FRESH", "STYLE", "TECH"],
                  },
                  {
                    name: "Temperature",
                    value: temp,
                    set: setTemp,
                    options: ["AMBIENT", "CHILLED"],
                  },
                  {
                    name: "District",
                    value: district,
                    set: setDistrict,
                    options: [...new Set(orders.map((o) => o.district))].sort(),
                  },
                  {
                    name: "Access",
                    value: access,
                    set: setAccess,
                    options: ["NORMAL", "VAN_ONLY", "MALL_DOCK"],
                  },
                ].map((f) => (
                  <label key={f.name} className="text-xs">
                    {f.name}
                    <select
                      className="mt-1 min-h-11 w-full rounded-lg border bg-card px-2 text-sm"
                      value={f.value}
                      onChange={(e) => f.set(e.target.value)}
                    >
                      <option value="">All</option>
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {label(o)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="space-y-3">
                {filtered.map((o) => (
                  <OrderCard
                    key={o.id}
                    order={o}
                    deferrals={view === "deferrals"}
                  />
                ))}
                {!filtered.length && (
                  <Empty>No orders match these filters.</Empty>
                )}
              </div>
            </Panel>
          )}
          {view === "fleet" && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {reference.data?.vehicles.map((v) => (
                <Panel key={v.id} title={v.id}>
                  <div className="mb-4 flex flex-wrap gap-2">
                    <Status>{label(v.type)}</Status>
                    <Status>
                      {v.refrigerated ? "Refrigerated" : "Ambient"}
                    </Status>
                    <Status warn={v.status !== "AVAILABLE"}>
                      {label(v.status)}
                    </Status>
                  </div>
                  <p>
                    {v.weightCapKg} kg · {v.volumeCapM3} m³
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {v.driver?.name ?? "No assigned driver"} ·{" "}
                    {v.weeklyFuelQuotaLiters} L weekly quota
                  </p>
                  <p className="mt-2 text-xs">
                    {trips.filter((t) => t.vehicleId === v.id).length} published
                    trips on {date}
                  </p>
                </Panel>
              ))}
            </div>
          )}
          {view === "reports" && (
            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="Service by brand">
                {["FRESH", "STYLE", "TECH"].map((brand) => {
                  const all = orders.filter((o) => o.brand === brand);
                  return (
                    <div
                      key={brand}
                      className="flex justify-between border-b py-4"
                    >
                      <span>{label(brand)}</span>
                      <span>
                        {
                          all.filter((o) => o.receipt?.status === "CONFIRMED")
                            .length
                        }{" "}
                        receipts confirmed / {all.length} orders
                      </span>
                    </div>
                  );
                })}
                <p className="mt-4 text-xs text-muted-foreground">
                  Includes the eligible queue and orders on published plans for
                  this date.
                </p>
              </Panel>
              <Panel title="Route estimates & receipt exceptions">
                <p className="mb-3">
                  {trips.reduce((n, t) => n + t.distanceKm, 0).toFixed(1)} km
                  planned round trips
                </p>
                <p className="mb-3">
                  {trips
                    .reduce((n, t) => n + t.reservedFuelLiters, 0)
                    .toFixed(2)}{" "}
                  L planned fuel
                </p>
                <p>
                  {
                    orders.filter((o) => o.receipt?.status === "DISPUTED")
                      .length
                  }{" "}
                  disputed receipts
                </p>
                <p className="mt-4 text-xs text-muted-foreground">
                  Planning estimates, not measured distance or actual
                  consumption.
                </p>
              </Panel>
            </div>
          )}
        </>
      )}
    </div>
  );
}
function TripCard({
  trip: t,
  orders,
  loading,
}: {
  trip: ManifestDto;
  orders: OrderDto[];
  loading: boolean;
}) {
  const complete = t.stops.filter((s) =>
    ["DELIVERED", "PARTIAL", "FAILED"].includes(s.state),
  ).length;
  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer">
        <div className="inline-flex w-[calc(100%-1.5rem)] flex-wrap items-center justify-between gap-3">
          <div>
            <strong className="font-id">{t.vehicleId}</strong>
            <span className="ml-2 text-sm">
              Trip {t.tripNumber} · {t.district}
            </span>
            <p className="mt-1 text-xs text-muted-foreground">
              {t.driver?.name ?? "Unassigned"} · {time(t.plannedDepartureAt)}–
              {time(t.plannedReturnAt)}
            </p>
          </div>
          <Status warn={t.openBlockingIssues > 0}>{label(t.state)}</Status>
        </div>
        <div className="mt-4 h-1.5 rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-ink"
            style={{
              width: `${t.stops.length ? (complete / t.stops.length) * 100 : 0}%`,
            }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {complete} of {t.stops.length} stops complete · {t.openBlockingIssues}{" "}
          blocking issues
        </p>
      </summary>
      <div className="mt-5 space-y-4">
        {loading && (
          <>
            <Capacity
              label="Weight"
              value={t.load.weightKg}
              max={t.capacity.weightCapKg}
              unit="kg"
            />
            <Capacity
              label="Volume"
              value={t.load.volumeM3}
              max={t.capacity.volumeCapM3}
              unit="m³"
            />
          </>
        )}
        {t.stops.map((s) => (
          <div key={s.stopId} className="border-t pt-3">
            <div className="flex flex-wrap justify-between gap-2">
              <strong className="text-sm">
                {s.sequence}. {s.outletLabel}
              </strong>
              <Status>{label(s.state)}</Status>
            </div>
            <p className="mt-1 text-xs">
              Estimated arrival {time(s.etaAt ?? s.plannedArrivalAt)} · window{" "}
              {s.windowOpen}–{s.windowClose}
            </p>
            {s.orders.map((o) => {
              const order = orders.find((x) => x.id === o.orderId);
              return (
                <div key={o.orderId} className="mt-3 text-sm">
                  <p className="font-id">{o.orderRef}</p>
                  {loading ? (
                    <p className="text-xs text-muted-foreground">
                      {
                        o.lines.filter(
                          (l) => l.check?.planRevision === t.planRevision,
                        ).length
                      }{" "}
                      / {o.lines.length} lines checked
                    </p>
                  ) : (
                    <>
                      <p className="text-xs">
                        Driver proof:{" "}
                        {label(order?.delivery?.outcome ?? "PENDING")} · Store
                        receipt: {label(order?.receipt?.status ?? "PENDING")}
                      </p>
                      {order?.delivery?.evidence.map((f) => (
                        <a
                          key={f.id}
                          className="mr-3 inline-flex min-h-11 items-center underline"
                          href={f.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Delivery evidence
                        </a>
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </details>
  );
}
function OrderCard({
  order: o,
  deferrals,
}: {
  order: OrderDto;
  deferrals: boolean;
}) {
  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer">
        <div className="inline-flex w-[calc(100%-1.5rem)] flex-wrap items-center justify-between gap-3">
          <div>
            <strong className="font-id text-sm">{o.orderRef}</strong>
            <p className="mt-1 text-sm text-muted-foreground">
              {o.outletLabel}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Status>{label(o.temp)}</Status>
            <span>
              {o.totals.weightKg} kg · {o.totals.volumeM3} m³
            </span>
            <Status warn={o.priorDeferrals.length > 0}>
              {o.priorDeferrals.length} missed runs
            </Status>
          </div>
        </div>
      </summary>
      <div className="mt-4 space-y-3 border-t pt-4 text-sm">
        <p>
          Requested {o.requestedDate} · Eligible {o.eligibleServiceDate} ·{" "}
          {label(o.status)}
        </p>
        {o.lines.map((l) => (
          <p key={l.id}>
            {l.orderedUnits} × {l.description}
          </p>
        ))}
        {o.deferral && (
          <div className="rounded-lg bg-warn-soft p-3">
            <strong>{label(o.deferral.reasonCode)}</strong>
            <p className="mt-1">{o.deferral.reasonText}</p>
            <p className="mt-2">Next run: {o.deferral.nextEligibleDate}</p>
          </div>
        )}
        {o.priorDeferrals.map((d) => (
          <p key={d.serviceDate}>
            {d.serviceDate}: {label(d.reasonCode)}
          </p>
        ))}
        {deferrals && (
          <p className="text-xs text-muted-foreground">
            Repeated missed service days raise priority within the same
            capability tier.
          </p>
        )}
        {o.status === "ALLOCATED" && o.delivery?.outcome === "FAILED" && (
          <FailedForm order={o} />
        )}
        {o.status === "PARTIALLY_DELIVERED" && (
          <p>
            A partial delivery needs a replacement order for the remaining
            goods; the full order cannot be requeued.
          </p>
        )}
      </div>
    </details>
  );
}
function IssueCard({ issue }: { issue: IssueDto }) {
  const mutation = useDispatcherMutation();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResolveIssueInput>({
    resolver: zodResolver(resolveIssueSchema),
    defaultValues: {
      expectedVersion: issue.version,
      action: "ACKNOWLEDGE",
      resolution: "",
    },
  });
  return (
    <details className="border-b py-3 last:border-0">
      <summary className="min-h-11 cursor-pointer text-sm font-medium">
        {issue.blocking && <span className="mr-2 text-late">Blocking</span>}
        {label(issue.type)} · {issue.orderRef ?? issue.reporter.name}
        <p className="mt-2 font-normal text-muted-foreground">{issue.text}</p>
      </summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={handleSubmit(async (body) => {
          await mutation
            .mutateAsync({ path: `issues/${issue.id}/resolve`, body })
            .catch(() => {});
        })}
      >
        <label className="block text-xs">
          Action
          <select
            className="mt-1 min-h-11 w-full rounded border bg-card px-2"
            {...register("action")}
          >
            <option value="ACKNOWLEDGE">Acknowledge</option>
            <option value="RESOLVE">Resolve</option>
          </select>
        </label>
        <label className="block text-xs">
          Resolution or next step
          <Textarea className="mt-1" {...register("resolution")} />
        </label>
        {errors.resolution && (
          <p role="alert" className="text-xs text-late">
            {errors.resolution.message}
          </p>
        )}
        <Button className="min-h-11" disabled={mutation.isPending}>
          Save update
        </Button>
      </form>
    </details>
  );
}
function FailedForm({ order }: { order: OrderDto }) {
  const mutation = useDispatcherMutation();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DeferOrderInput>({
    resolver: zodResolver(deferOrderSchema),
    defaultValues: {
      expectedVersion: order.version,
      reasonCode: "DELIVERY_FAILED",
      reasonText: "",
    },
  });
  return (
    <form
      className="space-y-3"
      onSubmit={handleSubmit(async (body) => {
        await mutation
          .mutateAsync({ path: `orders/${order.id}/defer`, body })
          .catch(() => {});
      })}
    >
      <label>
        Recovery explanation
        <Textarea {...register("reasonText")} />
      </label>
      {errors.reasonText && (
        <p role="alert" className="text-late">
          {errors.reasonText.message}
        </p>
      )}
      <Button className="min-h-11" disabled={mutation.isPending}>
        Defer failed delivery to next run
      </Button>
    </form>
  );
}
