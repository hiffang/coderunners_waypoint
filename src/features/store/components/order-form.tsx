"use client";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createOrderSchema,
  type CreateOrderInput,
  type OrderDto,
} from "@/shared/dto/order";
import { BRAND_TEMPS } from "@/shared/dto/enums";
import { outletLabel, type ReferenceDto } from "@/shared/dto/reference";
import { useStoreCommand, useStoreOrder, useStoreReference } from "../hooks";
import { orderTotals } from "../rules";
import {
  Back,
  date,
  Failure,
  Heading,
  label,
  Loading,
  Notice,
  Panel,
} from "./bits";

export function NewOrder() {
  const query = useStoreReference();
  if (query.isPending) return <Loading />;
  if (query.error)
    return <Failure error={query.error} retry={() => query.refetch()} />;
  return <OrderForm reference={query.data} />;
}
export function EditOrder({ id }: { id: string }) {
  const query = useStoreOrder(id);
  const reference = useStoreReference();
  if (query.isPending || reference.isPending) return <Loading />;
  if (query.error)
    return <Failure error={query.error} retry={() => query.refetch()} />;
  if (reference.error)
    return (
      <Failure error={reference.error} retry={() => reference.refetch()} />
    );
  if (!query.data.editable)
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Back id={id} />
        <Notice>
          This order is locked by cutoff, allocation, or manifest creation. Its
          goods cannot be edited.
        </Notice>
      </div>
    );
  return (
    <OrderForm key={id} reference={reference.data} order={query.data.order} />
  );
}
function OrderForm({
  reference,
  order,
}: {
  reference: ReferenceDto;
  order?: OrderDto;
}) {
  const router = useRouter();
  const command = useStoreCommand<OrderDto>();
  const outlet = reference.outlets[0];
  const form = useForm<CreateOrderInput>({
    resolver: zodResolver(createOrderSchema),
    defaultValues: {
      requestedDate:
        order?.requestedDate ?? reference.cutoff.earliestEligibleDate,
      temp: order?.temp ?? "AMBIENT",
      lines: order?.lines.map((l) => ({
        description: l.description,
        orderedUnits: l.orderedUnits,
        unitWeightKg: l.unitWeightKg,
        unitVolumeM3: l.unitVolumeM3,
      })) ?? [
        { description: "", orderedUnits: 1, unitWeightKg: 0, unitVolumeM3: 0 },
      ],
    },
  });
  const fields = useFieldArray({ control: form.control, name: "lines" });
  const values = useWatch({ control: form.control });
  const totals = orderTotals(
    (values.lines ?? []).map((l) => ({
      description: l.description ?? "",
      orderedUnits: Number(l.orderedUnits) || 0,
      unitWeightKg: Number(l.unitWeightKg) || 0,
      unitVolumeM3: Number(l.unitVolumeM3) || 0,
    })),
  );
  const earliest = reference.cutoff.earliestEligibleDate;
  const submit = form.handleSubmit(async (input) => {
    if (input.requestedDate < earliest) {
      form.setError("requestedDate", {
        message: `Choose ${earliest} or later.`,
      });
      return;
    }
    const day = reference.calendar.find((d) => d.date === input.requestedDate);
    if (day && !day.isOperating) {
      form.setError("requestedDate", { message: "Choose an operating day." });
      return;
    }
    const result = await command.execute(
      order ? `/api/store/orders/${order.id}` : "/api/store/orders",
      order ? { ...input, expectedVersion: order.version } : input,
      order ? "PATCH" : "POST",
    );
    if (result) {
      toast.success(order ? "Order updated" : "Order accepted");
      router.push(`/store/orders/${result.id}`);
    }
  });
  if (!outlet)
    return (
      <Notice>
        No outlet is assigned to this account. Contact your administrator.
      </Notice>
    );
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Back id={order?.id} />
      <Heading
        title={order ? "Edit order" : "Create an order"}
        description={`${outletLabel(outlet)} · ${outlet.depotName} depot`}
      />
      <Notice>
        Orders close at {reference.cutoff.localTime} Sri Lanka time. Earliest
        eligible run: {date(earliest)}. Acceptance is confirmed by the server
        when you submit.
      </Notice>
      <form onSubmit={submit} className="space-y-5">
        <fieldset disabled={command.isPending} className="space-y-5">
          <Panel>
            <h2 className="font-semibold">Delivery request</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="service-date">Requested service date</Label>
                <Input
                  id="service-date"
                  type="date"
                  min={earliest}
                  {...form.register("requestedDate")}
                  aria-invalid={Boolean(form.formState.errors.requestedDate)}
                />
                <p role="alert" className="text-sm text-late">
                  {form.formState.errors.requestedDate?.message}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="temperature">Goods temperature</Label>
                <select
                  id="temperature"
                  {...form.register("temp")}
                  className="h-9 w-full rounded-lg border bg-background px-3 text-sm"
                >
                  {BRAND_TEMPS[outlet.brand].map((t) => (
                    <option key={t} value={t}>
                      {label(t)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {outlet.brand === "FRESH"
                ? "Fresh orders can be placed daily. Submit ambient and chilled goods as separate orders."
                : outlet.brand === "STYLE"
                  ? "Style orders are normally weekly. Select an operating day agreed with your depot; an official outlet schedule has not been supplied."
                  : "Tech orders are placed as needed on operating days."}{" "}
              Advance dates are allowed.
            </p>
          </Panel>
          <Panel>
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <h2 className="font-semibold">Order lines</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Describe the goods and enter measured weight and volume per
                  unit.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  fields.append({
                    description: "",
                    orderedUnits: 1,
                    unitWeightKg: 0,
                    unitVolumeM3: 0,
                  })
                }
                disabled={fields.fields.length >= 50}
              >
                <Plus />
                Add line
              </Button>
            </div>
            {fields.fields.map((field, i) => (
              <div
                key={field.id}
                className="rounded-xl border bg-secondary/40 p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide">
                    Line {i + 1}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove line ${i + 1}`}
                    disabled={fields.fields.length === 1}
                    onClick={() => fields.remove(i)}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2">
                    <Label htmlFor={`description-${i}`}>Description</Label>
                    <Input
                      id={`description-${i}`}
                      placeholder="e.g. Sealed milk crates"
                      {...form.register(`lines.${i}.description`)}
                      aria-invalid={Boolean(
                        form.formState.errors.lines?.[i]?.description,
                      )}
                    />
                    <p className="text-xs text-late">
                      {form.formState.errors.lines?.[i]?.description?.message}
                    </p>
                  </div>
                  {(
                    ["orderedUnits", "unitWeightKg", "unitVolumeM3"] as const
                  ).map((name, n) => (
                    <div className="space-y-2" key={name}>
                      <Label htmlFor={`${name}-${i}`}>
                        {
                          ["Units", "Weight / unit (kg)", "Volume / unit (m³)"][
                            n
                          ]
                        }
                      </Label>
                      <Input
                        id={`${name}-${i}`}
                        type="number"
                        min={n === 0 ? 1 : 0}
                        step={n === 0 ? 1 : n === 1 ? 0.001 : 0.0001}
                        {...form.register(`lines.${i}.${name}`, {
                          valueAsNumber: true,
                        })}
                        aria-invalid={Boolean(
                          form.formState.errors.lines?.[i]?.[name],
                        )}
                      />
                      <p className="text-xs text-late">
                        {form.formState.errors.lines?.[i]?.[name]?.message}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Free-text descriptions are used because no official product
              catalog is supplied. Example: 12 sealed milk crates, 10 kg and
              0.04 m³ per crate.
            </p>
          </Panel>
          <Panel>
            <h2 className="font-semibold">Review totals</h2>
            <div className="grid grid-cols-3 gap-4">
              {[
                ["Units", totals.units],
                ["Weight (kg)", totals.weightKg.toFixed(2)],
                ["Volume (m³)", totals.volumeM3.toFixed(3)],
              ].map(([name, value]) => (
                <div key={name}>
                  <p className="text-xs text-muted-foreground">{name}</p>
                  <p className="font-id text-2xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Estimated totals. The server calculates and confirms the final
              totals.
            </p>
          </Panel>
        </fieldset>
        {command.error && (
          <div role="alert">
            <Notice>
              {command.error} Your changes are not confirmed. Refresh
              eligibility or retry the same submission.
            </Notice>
          </div>
        )}
        <div className="flex items-center justify-end gap-3">
          <Button
            type="submit"
            size="lg"
            className="bg-lime text-ink hover:bg-lime/80"
            disabled={command.isPending}
          >
            {command.isPending
              ? "Submitting…"
              : order
                ? "Save changes"
                : "Submit order"}
          </Button>
        </div>
      </form>
    </div>
  );
}
