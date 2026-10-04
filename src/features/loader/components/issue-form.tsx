"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OfflineStorageError } from "@/lib/offline";
import { cn } from "@/lib/utils";
import { ISSUE_SEVERITIES } from "@/shared/dto/enums";
import { queueIssue } from "../client-actions";
import { SEVERITY_LABEL } from "../format";
import { allLines, type ProjectedManifest } from "../projection";
import { useLoader } from "../session";

const TYPES = ["SHORTFALL", "DAMAGE", "OTHER"] as const;
const TYPE_LABEL: Record<(typeof TYPES)[number], string> = { SHORTFALL: "Shortfall", DAMAGE: "Damage", OTHER: "Other" };

const schema = z
  .object({
    type: z.enum(TYPES),
    severity: z.enum(ISSUE_SEVERITIES),
    orderId: z.string(),
    orderLineId: z.string(),
    units: z.number().int("Whole units only").min(0),
    reason: z.string().trim().min(1, "Say what happened").max(300),
    note: z.string().trim().max(500),
  })
  .superRefine((v, ctx) => {
    if (v.type !== "OTHER" && !v.orderId) ctx.addIssue({ code: "custom", path: ["orderId"], message: "Choose the order" });
    if (v.type !== "OTHER" && v.units < 1) ctx.addIssue({ code: "custom", path: ["units"], message: "How many units are affected?" });
  });
type Values = z.infer<typeof schema>;

export type IssuePrefill = Partial<Pick<Values, "type" | "orderId" | "orderLineId" | "units">>;

/** Shortfall/damage report. Saved on the device first; the dispatcher is notified once the server acknowledges it. */
export function IssueForm({ manifest, prefill, onDone }: { manifest: ProjectedManifest; prefill?: IssuePrefill; onDone?: () => void }) {
  const { scope } = useLoader();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: prefill?.type ?? "SHORTFALL",
      severity: "HIGH",
      orderId: prefill?.orderId ?? "",
      orderLineId: prefill?.orderLineId ?? "",
      units: prefill?.units ?? 0,
      reason: "",
      note: "",
    },
  });
  const [type, severity, orderId] = useWatch({ control: form.control, name: ["type", "severity", "orderId"] });
  const lines = allLines(manifest);
  const orders = manifest.stops.flatMap((s) => s.orders.map((o) => ({ ...o, stop: s })));
  const orderLines = lines.filter((l) => l.order.orderId === orderId);
  const errors = form.formState.errors;

  async function submit(v: Values) {
    const what = v.type === "SHORTFALL" ? "missing" : v.type === "DAMAGE" ? "damaged" : null;
    const line = lines.find((l) => l.line.orderLineId === v.orderLineId);
    const head = what ? `${v.units} unit${v.units === 1 ? "" : "s"} ${what}${line ? ` (L${line.line.lineNo} ${line.line.description})` : ""}: ` : "";
    const text = `${head}${v.reason}${v.note ? ` · Note: ${v.note}` : ""}`.slice(0, 1000);
    try {
      await queueIssue(scope, manifest, {
        type: v.type,
        severity: v.severity,
        ...(v.orderId ? { orderId: v.orderId } : {}),
        ...(v.orderLineId ? { orderLineId: v.orderLineId } : {}),
        text,
      });
      toast.success("Report saved on this device. The dispatcher is notified once the server confirms it.");
      onDone?.();
    } catch (err) {
      toast.error(err instanceof OfflineStorageError ? err.message : "Could not save the report. Nothing was saved.");
    }
  }

  const pill = (active: boolean) => cn("h-11 rounded-xl border text-sm font-medium", active ? "border-ink bg-ink text-white" : "bg-card");
  const select = "h-11 w-full rounded-xl border bg-card px-3 text-sm";

  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-4" data-testid="issue-form" noValidate>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Issue type">
        {TYPES.map((t) => (
          <button key={t} type="button" role="radio" aria-checked={type === t} className={pill(type === t)} onClick={() => form.setValue("type", t)}>
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Severity">
        {ISSUE_SEVERITIES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={severity === s} className={pill(severity === s)} onClick={() => form.setValue("severity", s)}>
            {SEVERITY_LABEL[s]}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        <Label htmlFor="issue-order">Order{type === "OTHER" ? " (optional)" : ""}</Label>
        <select
          id="issue-order"
          className={select}
          {...form.register("orderId", { onChange: () => form.setValue("orderLineId", "") })}
          aria-invalid={!!errors.orderId}
        >
          <option value="">Choose order…</option>
          {orders.map((o) => (
            <option key={o.orderId} value={o.orderId}>
              {o.orderRef} · stop {o.stop.sequence} · {o.stop.outletId} · {o.temp.toLowerCase()}
            </option>
          ))}
        </select>
        {errors.orderId && <p className="text-sm text-late">{errors.orderId.message}</p>}
      </div>

      {orderId && (
        <div className="space-y-1">
          <Label htmlFor="issue-line">Line (optional)</Label>
          <select id="issue-line" className={select} {...form.register("orderLineId")}>
            <option value="">Whole order</option>
            {orderLines.map(({ line }) => (
              <option key={line.orderLineId} value={line.orderLineId}>
                L{line.lineNo} · {line.description} · {line.expectedUnits} expected
              </option>
            ))}
          </select>
        </div>
      )}

      {type !== "OTHER" && (
        <div className="space-y-1">
          <Label htmlFor="issue-units">Units {type === "SHORTFALL" ? "missing" : "damaged"}</Label>
          <Input id="issue-units" inputMode="numeric" className="h-11 rounded-xl font-id" {...form.register("units", { valueAsNumber: true })} aria-invalid={!!errors.units} />
          {errors.units && <p className="text-sm text-late">{errors.units.message}</p>}
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="issue-reason">Reason</Label>
        <Input id="issue-reason" className="h-11 rounded-xl" placeholder="e.g. not in stock at the chiller" {...form.register("reason")} aria-invalid={!!errors.reason} />
        {errors.reason && <p className="text-sm text-late">{errors.reason.message}</p>}
      </div>
      <div className="space-y-1">
        <Label htmlFor="issue-note">Note (optional)</Label>
        <Textarea id="issue-note" rows={2} {...form.register("note")} />
      </div>

      <Button type="submit" className="h-12 w-full rounded-xl text-base" disabled={form.formState.isSubmitting} data-testid="issue-submit">
        Save report
      </Button>
      {type !== "OTHER" && (
        <p className="text-xs text-muted-foreground">Shortfall and damage reports block release until the goods are corrected and the issue is resolved.</p>
      )}
    </form>
  );
}
