"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Camera, ImagePlus, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { newId, OfflineStorageError, prepareEvidencePhoto } from "@/lib/offline";
import { cn } from "@/lib/utils";
import { DELIVERY_OUTCOMES, type DeliveryOutcome } from "@/shared/dto/enums";
import { queueOutcome } from "../client-actions";
import { checkOutcome } from "../outcome-rules";
import type { ProjectedStop, ProjectedTrip } from "../projection";
import { useDriver } from "../session";
import { bigButton } from "./bits";

const MAX_PHOTOS = 5;

const formSchema = z.object({
  outcome: z.enum(DELIVERY_OUTCOMES),
  recipientName: z.string().trim().max(120),
  note: z.string().trim().max(1000),
  failureReason: z.string().trim().max(500),
  lines: z.array(
    z.object({
      orderLineId: z.string(),
      deliveredUnits: z.number({ error: "Enter a number" }).int("Whole units").min(0, "Cannot be negative"),
      damagedUnits: z.number({ error: "Enter a number" }).int("Whole units").min(0, "Cannot be negative"),
    }),
  ),
});
type FormValues = z.infer<typeof formSchema>;

const OUTCOME_LABEL: Record<DeliveryOutcome, string> = { DELIVERED: "Delivered", PARTIAL: "Partial", FAILED: "Failed" };

type Photo = { clientFileId: string; blob: Blob; url: string };

export function OutcomeForm({ trip, stop }: { trip: ProjectedTrip; stop: ProjectedStop }) {
  const { scope } = useDriver();
  const lines = useMemo(
    () =>
      stop.orders.flatMap((o) =>
        o.lines.map((l) => ({ ...l, orderId: o.orderId, orderRef: o.orderRef, loaded: l.check?.loadedUnits ?? null })),
      ),
    [stop.orders],
  );
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      outcome: "DELIVERED",
      recipientName: "",
      note: "",
      failureReason: "",
      lines: lines.map((l) => ({ orderLineId: l.orderLineId, deliveredUnits: l.loaded ?? 0, damagedUnits: 0 })),
    },
  });
  const outcome = useWatch({ control: form.control, name: "outcome" });
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [saving, setSaving] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const errors = form.formState.errors;

  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  function chooseOutcome(next: DeliveryOutcome) {
    form.setValue("outcome", next);
    form.clearErrors();
    lines.forEach((l, i) => {
      form.setValue(`lines.${i}.deliveredUnits`, next === "FAILED" ? 0 : (l.loaded ?? 0));
      if (next === "FAILED") form.setValue(`lines.${i}.damagedUnits`, 0);
    });
  }

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const room = MAX_PHOTOS - photos.length;
    const added: Photo[] = [];
    for (const file of [...files].slice(0, room)) {
      try {
        const blob = await prepareEvidencePhoto(file);
        added.push({ clientFileId: newId(), blob, url: URL.createObjectURL(blob) });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Photo could not be used");
      }
    }
    if (files.length > room) toast.warning(`At most ${MAX_PHOTOS} photos per stop`);
    setPhotos((p) => [...p, ...added]);
  }

  async function submit(values: FormValues) {
    const check = checkOutcome(
      { outcome: values.outcome, lines: values.lines, failureReason: values.failureReason, note: values.note },
      lines.map((l) => ({ orderLineId: l.orderLineId, orderId: l.orderId, orderedUnits: l.expectedUnits, loadedUnits: l.loaded })),
    );
    let bad = false;
    if (!check.ok) {
      for (const [path, msgs] of Object.entries(check.fieldErrors)) {
        form.setError(path as never, { message: msgs[0] });
      }
      bad = true;
    }
    if (values.outcome === "FAILED" && !values.failureReason) {
      form.setError("failureReason", { message: "Say why the delivery failed" });
      bad = true;
    }
    if (values.outcome !== "FAILED" && !values.recipientName && photos.length === 0) {
      form.setError("recipientName", { message: "Add the recipient's name or at least one photo" });
      bad = true;
    }
    if (bad) return;

    setSaving(true);
    try {
      await queueOutcome(
        scope,
        trip,
        stop,
        {
          outcome: values.outcome,
          recipientName: values.recipientName || undefined,
          note: values.note || undefined,
          failureReason: values.failureReason || undefined,
          lines: values.lines,
        },
        photos.map(({ clientFileId, blob }) => ({ clientFileId, blob })),
      );
      toast.success("Outcome saved on this phone. The store sees it once it syncs.");
    } catch (err) {
      // Nothing was persisted: keep the form as it is so the driver can retry.
      toast.error(err instanceof OfflineStorageError ? err.message : "Could not save. Nothing was saved; try again.");
    } finally {
      setSaving(false);
    }
  }

  const reasonLabel = outcome === "FAILED" ? "Why did it fail? (required)" : outcome === "PARTIAL" ? "What was short or damaged? (required)" : "Reason";

  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-5" data-testid="outcome-form" noValidate>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Outcome</legend>
        <div className="grid grid-cols-3 gap-2" role="radiogroup">
          {DELIVERY_OUTCOMES.map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={outcome === o}
              onClick={() => chooseOutcome(o)}
              className={cn(
                "h-12 rounded-xl border text-sm font-semibold",
                outcome === o ? (o === "FAILED" ? "border-late bg-late-soft text-late" : o === "PARTIAL" ? "border-warn bg-warn-soft text-warn" : "border-ink bg-lime") : "bg-card",
              )}
            >
              {OUTCOME_LABEL[o]}
            </button>
          ))}
        </div>
        {errors.outcome && <p className="mt-1 text-sm text-late">{errors.outcome.message}</p>}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium">Quantities handed over</legend>
        {lines.map((l, i) => {
          const le = errors.lines?.[i];
          return (
            <div key={l.orderLineId} className="rounded-xl border p-3">
              <p className="text-sm font-medium">{l.description}</p>
              <p className="text-xs text-muted-foreground">
                <span className="font-id">{l.orderRef}</span> · ordered {l.expectedUnits} ·{" "}
                {l.loaded === null ? (
                  <span className="text-late">not checked by loader</span>
                ) : (
                  <span className={l.loaded < l.expectedUnits ? "font-semibold text-warn" : ""}>loaded {l.loaded}</span>
                )}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor={`d-${i}`} className="text-xs">
                    Delivered
                  </Label>
                  <Input
                    id={`d-${i}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={l.loaded ?? 0}
                    className="h-11 text-base"
                    disabled={outcome === "FAILED"}
                    {...form.register(`lines.${i}.deliveredUnits`, { valueAsNumber: true })}
                  />
                </div>
                <div>
                  <Label htmlFor={`x-${i}`} className="text-xs">
                    of which damaged
                  </Label>
                  <Input
                    id={`x-${i}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    className="h-11 text-base"
                    disabled={outcome === "FAILED"}
                    {...form.register(`lines.${i}.damagedUnits`, { valueAsNumber: true })}
                  />
                </div>
              </div>
              {(le?.deliveredUnits || le?.damagedUnits || le?.message || le?.root) && (
                <p className="mt-1 text-sm text-late">
                  {le?.deliveredUnits?.message ?? le?.damagedUnits?.message ?? le?.message ?? le?.root?.message}
                </p>
              )}
            </div>
          );
        })}
      </fieldset>

      {outcome !== "FAILED" && (
        <div>
          <Label htmlFor="recipient">Recipient name</Label>
          <Input id="recipient" className="mt-1 h-11 text-base" autoComplete="off" {...form.register("recipientName")} />
          {errors.recipientName && <p className="mt-1 text-sm text-late">{errors.recipientName.message}</p>}
        </div>
      )}

      {outcome !== "DELIVERED" && (
        <div>
          <Label htmlFor="reason">{reasonLabel}</Label>
          <Input id="reason" className="mt-1 h-11 text-base" {...form.register("failureReason")} />
          {errors.failureReason && <p className="mt-1 text-sm text-late">{errors.failureReason.message}</p>}
        </div>
      )}

      <div>
        <Label htmlFor="note">Note (optional)</Label>
        <Textarea id="note" className="mt-1 text-base" rows={2} {...form.register("note")} />
      </div>

      <div>
        <p className="text-sm font-medium">Photo evidence</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" className="h-12 rounded-xl" onClick={() => cameraRef.current?.click()} disabled={photos.length >= MAX_PHOTOS}>
            <Camera className="size-5" /> Take photo
          </Button>
          <Button type="button" variant="outline" className="h-12 rounded-xl" onClick={() => pickerRef.current?.click()} disabled={photos.length >= MAX_PHOTOS}>
            <ImagePlus className="size-5" /> Choose file
          </Button>
        </div>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            void addPhotos(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={pickerRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          data-testid="photo-input"
          onChange={(e) => {
            void addPhotos(e.target.files);
            e.target.value = "";
          }}
        />
        {photos.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {photos.map((p) => (
              <li key={p.clientFileId} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                <img src={p.url} alt="Evidence preview" className="size-20 rounded-lg object-cover" />
                <button
                  type="button"
                  aria-label="Remove photo"
                  className="absolute -top-2 -right-2 grid size-7 place-items-center rounded-full bg-ink text-white"
                  onClick={() => {
                    URL.revokeObjectURL(p.url);
                    setPhotos((all) => all.filter((x) => x.clientFileId !== p.clientFileId));
                  }}
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Team evidence rule: a delivered or partial stop needs the recipient&apos;s name or at least one photo. Failed stops need a reason; a photo is
          optional. Submitting records what you saw. It is not the recipient&apos;s signature.
        </p>
      </div>

      <Button type="submit" className={bigButton} disabled={saving} data-testid="submit-outcome">
        <Send className="size-5" /> {saving ? "Saving…" : "Save outcome"}
      </Button>
    </form>
  );
}
