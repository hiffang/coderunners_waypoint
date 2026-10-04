"use client";
import { LoadingScreen } from "@/components/loading-screen";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowDown, ArrowUp, Snowflake, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, ApiClientError } from "@/shared/api";
import {
  planDecisionsSchema,
  type ConstraintViolation,
  type PlanValidationDto,
} from "@/shared/dto/plan";
import { DEFERRAL_REASONS } from "@/shared/dto/enums";
import type { ReferenceDto } from "@/shared/dto/reference";
import { useDispatcherMutation, usePlan } from "../hooks";
import {
  ESTIMATE_NOTE,
  validatePlan,
  type Decision,
  type PlanningInput,
  type PlanningOrder,
} from "../server/planning/engine";
import { Capacity, Empty, Failure, label, Panel, Status, time } from "./bits";
import type { PlanDetail } from "../types";

export function Planner({ id }: { id: string }) {
  const query = usePlan(id);
  const reference = useQuery({
    queryKey: ["dispatcher", "reference"],
    queryFn: () => apiFetch<ReferenceDto>("/api/shared/reference"),
  });
  const mutation = useDispatcherMutation<PlanDetail>();
  const validationMutation = useDispatcherMutation<PlanValidationDto>();
  const [edits, setEdits] = useState<{
    version: number;
    decisions: Decision[];
  } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [serverValidation, setServerValidation] =
    useState<PlanValidationDto | null>(null);
  const [failures, setFailures] = useState<ConstraintViolation[]>([]);
  const [search, setSearch] = useState("");
  if (query.error && !query.data)
    return <Failure error={query.error} retry={() => void query.refetch()} />;
  if (reference.error)
    return (
      <Failure error={reference.error} retry={() => void reference.refetch()} />
    );
  if (!query.data || !reference.data)
    return (
      <LoadingScreen portal="dispatcher" title="Loading your plan" description="Preparing allocation decisions and fleet capacity." />
    );
  const plan = query.data;
  const ref = reference.data;
  const saved: Decision[] = plan.decisions.map((d) => {
    const trip = plan.manifests.find((t) => t.id === d.tripId);
    return {
      orderId: d.orderId,
      decision: d.decision,
      vehicleId: trip?.vehicleId,
      tripNumber: trip?.tripNumber as 1 | 2 | undefined,
      stopSequence: trip?.stops.find((s) => s.stopId === d.stopId)?.sequence,
      reasonCode: d.reasonCode ?? undefined,
      reasonText: d.reasonText ?? undefined,
    };
  });
  const decisions = edits?.decisions ?? saved;
  const locked =
    plan.status === "COMPLETED" ||
    plan.trips.some((t) => ["IN_TRANSIT", "COMPLETED"].includes(t.state));
  const busy = mutation.isPending || validationMutation.isPending;
  const conflict = edits !== null && edits.version !== plan.version;
  const input: PlanningInput = {
    depotId: plan.depotId,
    depotName: ref.depots.find((d) => d.id === plan.depotId)?.name ?? "",
    serviceDate: plan.serviceDate,
    operating: true,
    orders: plan.orders.map((o) =>
      plan.status === "PUBLISHED"
        ? {
            ...o,
            eligibleServiceDate: plan.serviceDate,
            status: "CONFIRMED" as const,
          }
        : o,
    ),
    vehicles: ref.vehicles.map((v) => {
      const u = plan.utilization.find(
        (u) => plan.trips.find((t) => t.id === u.tripId)?.vehicleId === v.id,
      );
      return {
        ...v,
        usedFuel: u?.weekFuelUsedLiters ?? 0,
        fuelQuota: u?.weekFuelQuotaLiters ?? v.weeklyFuelQuotaLiters,
        occupiedTrips: [],
      };
    }),
  };
  const preview = validatePlan(input, decisions);
  // Saved plans display the persisted manifest, including historical estimates.
  // Recompute only while the dispatcher is previewing a proposed edit.
  const displayedTrips = edits
    ? preview.trips
    : plan.manifests.map((trip) => ({
        key: `${trip.vehicleId}/${trip.tripNumber}`,
        vehicleId: trip.vehicleId,
        tripNumber: trip.tripNumber,
        orders: trip.stops.flatMap((s) =>
          s.orders.map((o) => plan.orders.find((row) => row.id === o.orderId)!),
        ),
        departure: minutesOf(trip.plannedDepartureAt),
        returned: minutesOf(trip.plannedReturnAt),
        distance: trip.distanceKm,
        fuel: trip.reservedFuelLiters,
        weight: trip.load.weightKg,
        volume: trip.load.volumeM3,
        stops: trip.stops.map((s) => ({
          outletId: s.outletId,
          sequence: s.sequence,
          arrival: minutesOf(s.plannedArrivalAt),
          orderIds: s.orders.map((o) => o.orderId),
        })),
      }));
  const selectedOrder = plan.orders.find((o) => o.id === selected);
  const update = (next: Decision[]) => {
    setEdits({ version: edits?.version ?? plan.version, decisions: next });
    setServerValidation(null);
    setFailures([]);
  };
  const action = async (name: "allocate" | "decisions" | "publish") => {
    setFailures([]);
    try {
      await mutation.mutateAsync({
        path: `plans/${id}/${name}`,
        method: name === "decisions" ? "PUT" : "POST",
        body: {
          expectedVersion: edits?.version ?? plan.version,
          ...(name === "decisions" ? { decisions } : {}),
        },
      });
      setEdits(null);
      setServerValidation(null);
      toast.success(
        name === "publish"
          ? "Plan published to loading and delivery teams"
          : "Plan saved",
      );
    } catch (e) {
      if (
        e instanceof ApiClientError &&
        e.details &&
        typeof e.details === "object" &&
        "violations" in e.details
      )
        setFailures(e.details.violations as ConstraintViolation[]);
    }
  };
  const validate = async () => {
    try {
      const result = await validationMutation.mutateAsync({
        path: `plans/${id}/validate`,
        body: { expectedVersion: plan.version },
      });
      setServerValidation(result);
      setFailures(result.violations);
    } catch {}
  };
  const move = (orderId: string, delta: number) => {
    const d = decisions.find((d) => d.orderId === orderId)!;
    const target = (d.stopSequence ?? 1) + delta;
    if (target < 1) return;
    update(
      decisions.map((x) =>
        x.vehicleId === d.vehicleId && x.tripNumber === d.tripNumber
          ? {
              ...x,
              stopSequence:
                x.stopSequence === d.stopSequence
                  ? target
                  : x.stopSequence === target
                    ? d.stopSequence
                    : x.stopSequence,
            }
          : x,
      ),
    );
  };
  const violations = failures.length
    ? failures
    : plan.status !== "DRAFT" && !edits
      ? []
      : preview.violations;
  return (
    <div className="mx-auto max-w-[1700px] space-y-5">
      <Link
        href={`/dispatcher/routes?serviceDate=${plan.serviceDate}`}
        className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
      >
        <ArrowLeft className="size-4" /> All routes
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">
            {input.depotName} · {plan.serviceDate} · Asia/Colombo
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">
              Route planning
            </h1>
            <Status>
              {label(plan.status)} · revision {plan.revision}
            </Status>
            {edits && <Status warn>Unsaved changes</Status>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="min-h-11 bg-card"
            disabled={busy || locked || !!edits || plan.status !== "DRAFT"}
            onClick={() => void action("allocate")}
          >
            Auto-allocate queue
          </Button>
          <Button
            className="min-h-11"
            disabled={busy || locked || !edits || conflict}
            onClick={() => void action("decisions")}
          >
            {plan.status === "PUBLISHED"
              ? "Save & republish revision"
              : "Save draft"}
          </Button>
          <Button
            variant="outline"
            className="min-h-11 bg-card"
            disabled={busy || !!edits || locked || plan.status !== "DRAFT"}
            onClick={() => void validate()}
          >
            Validate plan
          </Button>
          {plan.status === "DRAFT" && (
            <Button
              className="min-h-11 bg-lime text-ink hover:bg-lime/80"
              disabled={
                busy ||
                !!edits ||
                !serverValidation?.valid ||
                serverValidation.version !== plan.version
              }
              onClick={() => void action("publish")}
            >
              Publish plan
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {ESTIMATE_NOTE}
      </p>
      {locked && (
        <div className="rounded-lg border bg-warn-soft p-4 text-sm">
          This plan has departed trips and is locked. Coordinate recovery
          through the delivery monitor.
        </div>
      )}
      {plan.status === "PUBLISHED" && !locked && (
        <div className="rounded-lg border bg-warn-soft p-4 text-sm">
          Saving changes republishes the plan and resets loading checks and
          readiness. Loaders must refresh and verify the new manifest.
        </div>
      )}
      {query.isError && (
        <Failure error={query.error} retry={() => void query.refetch()} />
      )}
      {conflict && (
        <div role="alert" className="rounded-lg bg-late-soft p-4">
          The plan changed while you were editing. Your edits have been kept,
          but cannot overwrite the newer version.
          <Button
            variant="outline"
            className="ml-3 min-h-11"
            onClick={() => setEdits(null)}
          >
            Discard edits and use latest
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-4 border-y py-3 text-sm">
        <strong>
          {decisions.filter((d) => d.decision === "SERVED").length} /{" "}
          {plan.orders.length} orders assigned
        </strong>
        <span>
          {decisions.filter((d) => d.decision === "DEFERRED").length} deferred
        </span>
        <span>{plan.orders.length - decisions.length} undecided</span>
        <span className="ml-auto text-muted-foreground">
          {displayedTrips.length} trips · estimated{" "}
          {displayedTrips.reduce((n, t) => n + t.fuel, 0).toFixed(2)} L
        </span>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_310px]">
        <Panel title="Orders to plan">
          <label className="text-xs">
            Find order or outlet
            <Input
              className="my-3 min-h-11"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search queue"
            />
          </label>
          <div className="space-y-2">
            {plan.orders
              .filter((o) =>
                `${o.orderRef} ${o.outletLabel}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((o) => {
                const d = decisions.find((d) => d.orderId === o.id);
                return (
                  <button
                    type="button"
                    key={o.id}
                    onClick={() => setSelected(o.id)}
                    aria-pressed={selected === o.id}
                    className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring ${selected === o.id ? "border-ink bg-lime-soft" : "bg-card"}`}
                  >
                    <div className="flex justify-between gap-2">
                      <strong className="break-all font-id text-xs">
                        {o.orderRef}
                      </strong>
                      {o.temp === "CHILLED" && (
                        <Snowflake
                          aria-label="Chilled"
                          className="size-4 shrink-0 text-chilled"
                        />
                      )}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {o.outletLabel}
                    </p>
                    <p className="mt-2 text-xs">
                      {o.totals.weightKg} kg · {o.totals.volumeM3} m³
                    </p>
                    <p className="mt-1 text-xs">
                      By {o.outlet.windowClose} · {o.priorDeferrals.length}{" "}
                      missed runs
                    </p>
                    <p className="mt-2 text-xs font-semibold">
                      {d?.decision === "SERVED"
                        ? `${d.vehicleId} · trip ${d.tripNumber}`
                        : d?.decision === "DEFERRED"
                          ? "Deferred"
                          : "Needs a decision"}
                    </p>
                  </button>
                );
              })}
            {!plan.orders.length && (
              <Empty>No eligible orders for this date.</Empty>
            )}
          </div>
        </Panel>
        <div className="grid min-w-0 gap-4 md:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
          {displayedTrips.map((t) => {
            const v = input.vehicles.find((v) => v.id === t.vehicleId)!;
            const failed = violations.some((x) => x.tripId === t.key);
            return (
              <section
                key={t.key}
                className={`min-w-0 rounded-xl border bg-card p-5 ${failed ? "border-late" : ""}`}
              >
                <div className="flex justify-between">
                  <h2 className="font-id text-lg font-bold">{t.vehicleId}</h2>
                  <Truck className="size-5" />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Trip {t.tripNumber} · {t.orders[0].district} ·{" "}
                  {label(t.orders[0].brand)}
                </p>
                <div className="my-4 flex gap-2">
                  <Status>{v.refrigerated ? "Refrigerated" : "Ambient"}</Status>
                  <Status>{label(v.type)}</Status>
                </div>
                <div className="space-y-4">
                  <Capacity
                    label="Weight"
                    value={t.weight}
                    max={v.weightCapKg}
                    unit="kg"
                  />
                  <Capacity
                    label="Volume"
                    value={t.volume}
                    max={v.volumeCapM3}
                    unit="m³"
                  />
                  <Capacity
                    label="Week fuel (all planned trips)"
                    value={
                      v.usedFuel +
                      displayedTrips
                        .filter((trip) => trip.vehicleId === v.id)
                        .reduce((total, trip) => total + trip.fuel, 0)
                    }
                    max={v.fuelQuota}
                    unit="L"
                  />
                </div>
                <ol className="my-5 space-y-4">
                  {t.stops.map((s) => (
                    <li key={s.sequence} className="border-t pt-3">
                      <div className="flex justify-between text-sm">
                        <strong>
                          {s.sequence}. {s.outletId}
                        </strong>
                        <span className="font-id">{clock(s.arrival)}</span>
                      </div>
                      {s.orderIds.map((orderId) => (
                        <button
                          key={orderId}
                          type="button"
                          onClick={() => setSelected(orderId)}
                          className="min-h-11 text-left font-id text-xs underline"
                        >
                          {plan.orders.find((o) => o.id === orderId)?.orderRef}
                        </button>
                      ))}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="min-h-11"
                          aria-label={`Move ${s.outletId} earlier`}
                          disabled={locked || busy || s.sequence === 1}
                          onClick={() => move(s.orderIds[0], -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          variant="outline"
                          className="min-h-11"
                          aria-label={`Move ${s.outletId} later`}
                          disabled={
                            locked || busy || s.sequence === t.stops.length
                          }
                          onClick={() => move(s.orderIds[0], 1)}
                        >
                          <ArrowDown />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="rounded-lg bg-secondary p-3 text-xs">
                  <p>
                    Depart {clock(t.departure)} · Return {clock(t.returned)}
                  </p>
                  <p className="mt-2">
                    {t.distance} km round trip · {t.fuel.toFixed(2)} L
                  </p>
                </div>
              </section>
            );
          })}
          {!displayedTrips.length && (
            <Panel>
              <Empty>
                Select an order to assign it to a vehicle, or use assisted
                allocation to prepare a draft.
              </Empty>
            </Panel>
          )}
        </div>
        <div className="space-y-4 lg:col-span-2 xl:col-span-1">
          {selectedOrder && !locked && (
            <Panel title={selectedOrder.orderRef}>
              <Assignment
                key={`${selectedOrder.id}-${edits?.version ?? plan.version}-${JSON.stringify(decisions.find((d) => d.orderId === selectedOrder.id))}`}
                order={selectedOrder}
                decision={decisions.find((d) => d.orderId === selectedOrder.id)}
                reference={ref}
                disabled={busy || conflict}
                onSave={(d) =>
                  update([
                    ...decisions.filter((x) => x.orderId !== d.orderId),
                    d,
                  ])
                }
              />
            </Panel>
          )}
          <Panel
            title={
              violations.length
                ? `${violations.length} planning checks need attention`
                : "Planning checks"
            }
          >
            {violations.length ? (
              <ul className="space-y-3 text-sm" aria-live="polite">
                {violations.map((v, i) => (
                  <li
                    key={`${v.code}-${i}`}
                    className="rounded-lg bg-warn-soft p-3"
                  >
                    <strong className="text-xs uppercase">
                      {label(v.code)}
                    </strong>
                    <p className="mt-1">{v.message}</p>
                    {v.orderId && (
                      <button
                        className="mt-2 min-h-11 underline"
                        onClick={() => setSelected(v.orderId!)}
                      >
                        Review assignment
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">
                {plan.status !== "DRAFT" && !edits
                  ? "Showing the saved published manifest. Assignment changes will preview a new revision."
                  : serverValidation?.valid &&
                      serverValidation.version === plan.version
                    ? "Server validation passed. This draft can be published."
                    : "Local estimates are feasible. Save and validate on the server to check current fleet, eligibility and fuel."}
              </p>
            )}
          </Panel>
          {plan.decisions
            .filter((d) => d.decision === "DEFERRED")
            .map((d) => (
              <Panel key={d.orderId} title={d.orderRef}>
                <p className="text-sm">{d.reasonText}</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {d.priorityNote}
                </p>
                <p className="mt-2 text-xs">
                  Next eligible run: {d.nextEligibleDate}
                </p>
              </Panel>
            ))}
        </div>
      </div>
      {plan.publishedAt && (
        <p className="text-xs text-muted-foreground">
          Published at {time(plan.publishedAt)} · version {plan.version}
        </p>
      )}
    </div>
  );
}
function minutesOf(instant: string) {
  const [hours, minutes] = time(instant).split(":").map(Number);
  return hours * 60 + minutes;
}
function clock(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
function Assignment({
  order,
  decision,
  reference,
  disabled,
  onSave,
}: {
  order: PlanningOrder;
  decision?: Decision;
  reference: ReferenceDto;
  disabled: boolean;
  onSave: (d: Decision) => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<Decision>({
    resolver: zodResolver(planDecisionsSchema.shape.decisions.element),
    defaultValues: decision ?? {
      orderId: order.id,
      decision: "SERVED",
      tripNumber: 1,
      stopSequence: 1,
      reasonCode: "OTHER",
    },
  });
  const kind = useWatch({ control, name: "decision" });
  return (
    <form className="space-y-4" onSubmit={handleSubmit(onSave)}>
      <p className="text-xs text-muted-foreground">
        {order.outletLabel} · {label(order.outlet.parkingConstraint)} ·{" "}
        {order.outlet.windowOpen}–{order.outlet.windowClose}
      </p>
      <label className="block text-xs">
        Decision
        <select
          className="mt-1 min-h-11 w-full rounded border bg-card px-2 text-sm"
          {...register("decision")}
        >
          <option value="SERVED">Assign to a trip</option>
          <option value="DEFERRED">Defer to next run</option>
        </select>
      </label>
      {kind === "SERVED" ? (
        <>
          <label className="block text-xs">
            Vehicle
            <select
              className="mt-1 min-h-11 w-full rounded border bg-card px-2 text-sm"
              {...register("vehicleId", {
                setValueAs: (v: string) => v || undefined,
              })}
            >
              <option value="">Choose vehicle</option>
              {reference.vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id} · {label(v.type)}
                  {v.refrigerated ? " · chilled" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs">
              Trip
              <select
                className="mt-1 min-h-11 w-full rounded border bg-card px-2 text-sm"
                {...register("tripNumber", { valueAsNumber: true })}
              >
                <option value="1">1</option>
                <option value="2">2</option>
              </select>
            </label>
            <label className="text-xs">
              Stop position
              <Input
                className="mt-1 min-h-11"
                type="number"
                min={1}
                {...register("stopSequence", { valueAsNumber: true })}
              />
            </label>
          </div>
        </>
      ) : (
        <>
          <label className="block text-xs">
            Deferral reason
            <select
              className="mt-1 min-h-11 w-full rounded border bg-card px-2 text-sm"
              {...register("reasonCode")}
            >
              {DEFERRAL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {label(r)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            Explain why
            <Textarea className="mt-1" {...register("reasonText")} />
          </label>
        </>
      )}
      {Object.entries(errors).map(([key, e]) => (
        <p key={key} role="alert" className="text-xs text-late">
          {e.message}
        </p>
      ))}
      <Button className="min-h-11 w-full" disabled={disabled}>
        Apply to draft
      </Button>
    </form>
  );
}
