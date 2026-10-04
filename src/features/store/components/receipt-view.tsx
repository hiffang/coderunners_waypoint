"use client";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { receiptSchema, type OrderDto } from "@/shared/dto/order";
import { z } from "zod";
import { useStoreCommand, useStoreOrder } from "../hooks";
import { canReceive, isDisputed, receiptProblem } from "../rules";
import {
  Back,
  Failure,
  Heading,
  instant,
  Loading,
  Notice,
  Panel,
  Status,
} from "./bits";

export function LineTable({ order }: { order: OrderDto }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {[
            "Goods",
            "Ordered",
            "Loaded",
            "Delivered",
            "Received",
            "Damaged at receipt",
          ].map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {order.lines.map((l) => (
          <TableRow key={l.id}>
            <TableCell className="whitespace-normal">{l.description}</TableCell>
            {[
              l.orderedUnits,
              l.loadedUnits,
              l.deliveredUnits,
              l.receivedUnits,
              l.receiptDamageUnits,
            ].map((value, i) => (
              <TableCell key={i} className="font-id">
                {value ?? "—"}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
export function ReceiptView({ id }: { id: string }) {
  const query = useStoreOrder(id);
  if (query.isPending) return <Loading />;
  if (query.error && !query.data)
    return <Failure error={query.error} retry={() => query.refetch()} />;
  if (!query.data) return null;
  const o = query.data.order;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Back id={id} />
      <Heading
        title={o.receipt ? "Store receipt" : "Confirm received goods"}
        description={`${o.orderRef} · ${o.outletLabel}`}
      />
      <Panel>
        <h2 className="font-semibold">Compare quantities</h2>
        <LineTable order={o} />
      </Panel>
      {o.receipt ? (
        <Panel>
          <Status
            value={o.receipt.status === "DISPUTED" ? "DISPUTED" : "RECEIVED"}
          />
          <p className="text-sm">Received {instant(o.receipt.receivedAt)}</p>
          <p className="whitespace-pre-wrap text-sm">{o.receipt.note}</p>
          {o.receipt.status === "DISPUTED" && (
            <Notice>
              Your discrepancy has been sent to the dispatcher. Follow the issue
              history on the order page for a response.
            </Notice>
          )}
        </Panel>
      ) : canReceive(o) ? (
        <ReceiptForm key={`${id}-${o.delivery?.submittedAt}`} order={o} />
      ) : (
        <Notice>
          Receipt is unavailable until a delivered or partially delivered
          outcome is synchronized by the driver. An arrival alone does not
          confirm delivery.
        </Notice>
      )}
      {o.delivery?.evidence.length ? (
        <Panel>
          <h2 className="font-semibold">Driver evidence</h2>
          {o.delivery.evidence.map((f, i) => (
            <a
              className="mr-4 text-sm underline"
              key={f.id}
              href={f.url}
              target="_blank"
              rel="noreferrer"
            >
              View evidence {i + 1}
            </a>
          ))}
        </Panel>
      ) : null}
    </div>
  );
}
function ReceiptForm({ order }: { order: OrderDto }) {
  const command = useStoreCommand<OrderDto>();
  const form = useForm<
    z.input<typeof receiptSchema>,
    unknown,
    z.output<typeof receiptSchema>
  >({
    resolver: zodResolver(receiptSchema),
    defaultValues: {
      expectedVersion: order.version,
      note: "",
      attachmentIds: [],
      lines: order.lines.map((l) => ({
        orderLineId: l.id,
        receivedUnits: l.deliveredUnits ?? 0,
        damageUnits: l.deliveryDamagedUnits ?? 0,
      })),
    },
  });
  const lines = useWatch({ control: form.control, name: "lines" });
  const complete = (lines ?? []).map((l) => ({
    orderLineId: l.orderLineId ?? "",
    receivedUnits: l.receivedUnits ?? 0,
    damageUnits: l.damageUnits ?? 0,
  }));
  const disputed = isDisputed(order, complete);
  return (
    <form
      className="space-y-5"
      onSubmit={form.handleSubmit(async (values) => {
        const problem = receiptProblem(order, values.lines);
        if (problem) {
          form.setError("root", { message: problem });
          return;
        }
        const result = await command.execute(
          `/api/store/orders/${order.id}/receipt`,
          { ...values, expectedVersion: order.version },
        );
        if (result)
          toast.success(
            result.receipt?.status === "DISPUTED"
              ? "Receipt recorded and discrepancy reported"
              : "Receipt confirmed",
          );
      })}
    >
      <Panel>
        <h2 className="font-semibold">Actual receipt</h2>
        <p className="text-sm text-muted-foreground">
          Count the goods that arrived. Damaged units are included in the
          received total.
        </p>
        <fieldset disabled={command.isPending} className="space-y-4">
          {order.lines.map((l, i) => (
            <div
              key={l.id}
              className="grid items-start gap-3 rounded-xl border p-4 sm:grid-cols-3"
            >
              <div>
                <p className="text-sm font-medium">{l.description}</p>
                <p className="text-xs text-muted-foreground">
                  Delivered: {l.deliveredUnits} · Driver damage:{" "}
                  {l.deliveryDamagedUnits ?? 0}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`received-${i}`}>Received units</Label>
                <Input
                  id={`received-${i}`}
                  type="number"
                  min={0}
                  max={l.deliveredUnits ?? 0}
                  step={1}
                  {...form.register(`lines.${i}.receivedUnits`, {
                    valueAsNumber: true,
                  })}
                />
                <p className="text-xs text-late">
                  {form.formState.errors.lines?.[i]?.receivedUnits?.message}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`damaged-${i}`}>Damaged units</Label>
                <Input
                  id={`damaged-${i}`}
                  type="number"
                  min={0}
                  max={complete[i]?.receivedUnits ?? 0}
                  step={1}
                  {...form.register(`lines.${i}.damageUnits`, {
                    valueAsNumber: true,
                  })}
                />
                <p className="text-xs text-late">
                  {form.formState.errors.lines?.[i]?.damageUnits?.message}
                </p>
              </div>
            </div>
          ))}
          <Label htmlFor="receipt-note">Receipt note (optional)</Label>
          <Textarea
            id="receipt-note"
            maxLength={1000}
            placeholder="Describe any missing or damaged goods…"
            {...form.register("note")}
          />
          <p className="text-xs text-late">
            {form.formState.errors.note?.message}
          </p>
        </fieldset>
      </Panel>
      {disputed && (
        <Notice>
          This receipt has a shortfall or damage. Confirmation will record a
          disputed receipt and open an issue for the dispatcher.
        </Notice>
      )}
      {form.formState.errors.root && (
        <p role="alert" className="text-sm text-late">
          {form.formState.errors.root.message}
        </p>
      )}
      {command.error && (
        <div role="alert">
          <Notice>
            {command.error} Receipt is not confirmed. Retry the same submission
            when connected.
          </Notice>
        </div>
      )}
      <Button
        className="bg-lime text-ink hover:bg-lime/80"
        size="lg"
        type="submit"
        disabled={command.isPending}
      >
        {command.isPending
          ? "Recording…"
          : disputed
            ? "Confirm receipt & report discrepancy"
            : "Confirm receipt"}
      </Button>
    </form>
  );
}
