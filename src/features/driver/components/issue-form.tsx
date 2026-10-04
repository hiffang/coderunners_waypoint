"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OfflineStorageError } from "@/lib/offline";
import { cn } from "@/lib/utils";
import { ISSUE_SEVERITIES } from "@/shared/dto/enums";
import { queueIssue } from "../client-actions";
import type { ProjectedStop, ProjectedTrip } from "../projection";
import { useDriver } from "../session";

const TYPES = ["DELAY", "ACCESS", "DAMAGE", "OTHER"] as const;
const TYPE_LABEL: Record<(typeof TYPES)[number], string> = { DELAY: "Delay", ACCESS: "Access", DAMAGE: "Damage", OTHER: "Other" };

const schema = z.object({
  type: z.enum(TYPES),
  severity: z.enum(ISSUE_SEVERITIES),
  text: z.string().trim().min(1, "Describe what happened").max(1000),
});
type Values = z.infer<typeof schema>;

export function IssueForm({ trip, stop, onDone }: { trip: ProjectedTrip; stop: ProjectedStop; onDone?: () => void }) {
  const { scope } = useDriver();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { type: "DELAY", severity: "MEDIUM", text: "" } });
  const type = useWatch({ control: form.control, name: "type" });
  const severity = useWatch({ control: form.control, name: "severity" });

  async function submit(v: Values) {
    try {
      await queueIssue(scope, trip, stop, v);
      toast.success("Issue saved on this phone. The dispatcher sees it after it syncs.");
      form.reset({ type: v.type, severity: "MEDIUM", text: "" });
      onDone?.();
    } catch (err) {
      toast.error(err instanceof OfflineStorageError ? err.message : "Could not save the issue. Nothing was saved.");
    }
  }

  const pill = (active: boolean) => cn("h-11 rounded-xl border text-sm font-medium", active ? "border-ink bg-ink text-white" : "bg-card");

  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-4" data-testid="issue-form" noValidate>
      <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Issue type">
        {TYPES.map((t) => (
          <button key={t} type="button" role="radio" aria-checked={type === t} className={pill(type === t)} onClick={() => form.setValue("type", t)}>
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Severity">
        {ISSUE_SEVERITIES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={severity === s} className={pill(severity === s)} onClick={() => form.setValue("severity", s)}>
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      <div>
        <Label htmlFor="issue-text">What happened?</Label>
        <Textarea id="issue-text" rows={3} className="mt-1 text-base" {...form.register("text")} />
        {form.formState.errors.text && <p className="mt-1 text-sm text-late">{form.formState.errors.text.message}</p>}
      </div>
      <Button type="submit" variant="outline" className="h-12 w-full rounded-xl" disabled={form.formState.isSubmitting} data-testid="submit-issue">
        Save issue
      </Button>
    </form>
  );
}
