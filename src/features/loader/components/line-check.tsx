"use client";

import { Minus, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { clock, kg } from "../format";
import type { ProjectedLine } from "../projection";
import { LineBadge } from "./bits";

/** Unsaved edit of one line. loaded === null means "not touched" (different from a deliberate 0). */
export type LineDraft = { loaded: number | null; damaged: number; note: string };

export function draftErrors(line: Pick<ProjectedLine, "expectedUnits">, d: LineDraft): string[] {
  const errs: string[] = [];
  if (d.loaded === null) return errs;
  if (!Number.isInteger(d.loaded) || d.loaded < 0) errs.push("Loaded must be a whole number, 0 or more");
  if (d.loaded > line.expectedUnits) errs.push(`Loaded cannot exceed the ${line.expectedUnits} expected`);
  if (!Number.isInteger(d.damaged) || d.damaged < 0) errs.push("Damaged must be a whole number, 0 or more");
  if (d.damaged > d.loaded) errs.push("Damaged cannot exceed loaded");
  return errs;
}

export function LineCheck({
  line,
  draft,
  disabled,
  onDraft,
  onReport,
}: {
  line: ProjectedLine;
  draft: LineDraft | undefined;
  disabled: boolean;
  onDraft: (d: LineDraft | undefined) => void;
  onReport: (kind: "SHORTFALL" | "DAMAGE", units: number) => void;
}) {
  const c = line.check;
  const shownLoaded = line.local?.loadedUnits ?? c?.loadedUnits ?? null;
  const shownDamaged = line.local?.damageUnits ?? c?.damageUnits ?? 0;
  const base: LineDraft = { loaded: shownLoaded, damaged: shownDamaged, note: line.local?.note ?? c?.note ?? "" };
  const d = draft ?? base;
  const errors = draft ? draftErrors(line, draft) : [];
  const edit = (patch: Partial<LineDraft>) => onDraft({ ...d, ...patch });
  const missing = shownLoaded === null ? 0 : line.expectedUnits - shownLoaded;

  return (
    <li className={cn("rounded-xl border p-3", draft && "border-ink/50 bg-secondary/40")} data-testid="line-check" data-line-id={line.orderLineId}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            <span className="mr-1 font-id text-xs text-muted-foreground">L{line.lineNo}</span>
            {line.description}
          </p>
          <p className="text-xs text-muted-foreground">
            Expected <b className="font-id text-foreground">{line.expectedUnits}</b> units · {kg(line.unitWeightKg)}/unit
          </p>
        </div>
        {draft ? <span className="text-xs font-semibold text-ink">Editing</span> : <LineBadge status={line.status} />}
      </div>

      {!draft && (c || line.local) && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="line-recorded">
          {line.local ? (
            <span className="font-medium text-warn">Queued on this device · not sent yet · </span>
          ) : (
            <span>
              Confirmed by server · {c?.checkedBy.name} {clock(c?.checkedAt)} · rev {c?.planRevision} ·{" "}
            </span>
          )}
          loaded <b className="font-id">{shownLoaded}</b>
          {shownDamaged > 0 && (
            <>
              , damaged <b className="font-id">{shownDamaged}</b>
            </>
          )}
        </p>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Counter
          label="Loaded"
          value={d.loaded}
          max={line.expectedUnits}
          disabled={disabled}
          onChange={(v) => edit({ loaded: v, damaged: Math.min(d.damaged, v ?? 0) })}
          placeholder="—"
        />
        <Counter label="Damaged" value={d.damaged} max={d.loaded ?? 0} disabled={disabled || d.loaded === null} onChange={(v) => edit({ damaged: v ?? 0 })} />
      </div>

      {!disabled && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" className="h-11 flex-1 rounded-xl" onClick={() => edit({ loaded: line.expectedUnits, damaged: 0 })} data-testid="all-loaded">
            All {line.expectedUnits} loaded
          </Button>
          {draft && (
            <Button type="button" variant="ghost" className="h-11 rounded-xl" onClick={() => onDraft(undefined)}>
              Undo
            </Button>
          )}
        </div>
      )}

      {draft && draft.loaded !== null && (draft.loaded < line.expectedUnits || draft.damaged > 0) && (
        <Input
          className="mt-2 h-11 rounded-xl"
          placeholder="Note (optional), e.g. only 3 crates on the pallet"
          maxLength={500}
          value={draft.note}
          onChange={(e) => edit({ note: e.target.value })}
          aria-label="Line note"
        />
      )}

      {errors.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-sm text-late" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {!draft && !disabled && (line.status === "short" || line.status === "damaged") && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-late-soft p-2 text-sm text-late">
          <TriangleAlert className="size-4 shrink-0" />
          <span className="flex-1">
            {line.status === "short" ? `${missing} unit${missing === 1 ? "" : "s"} missing` : `${shownDamaged} unit${shownDamaged === 1 ? "" : "s"} damaged`}.
            Report it so the dispatcher can act.
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 shrink-0 rounded-lg bg-card"
            onClick={() => (line.status === "short" ? onReport("SHORTFALL", missing) : onReport("DAMAGE", shownDamaged))}
            data-testid="report-line"
          >
            Report
          </Button>
        </div>
      )}
    </li>
  );
}

function Counter({
  label,
  value,
  max,
  disabled,
  onChange,
  placeholder,
}: {
  label: string;
  value: number | null;
  max: number;
  disabled: boolean;
  onChange: (v: number | null) => void;
  placeholder?: string;
}) {
  const v = value ?? 0;
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="size-12 shrink-0 rounded-xl"
          aria-label={`${label} minus one`}
          disabled={disabled || value === null || v <= 0}
          onClick={() => onChange(v - 1)}
        >
          <Minus className="size-5" />
        </Button>
        <Input
          inputMode="numeric"
          className="h-12 rounded-xl text-center font-id text-lg"
          aria-label={label}
          disabled={disabled}
          placeholder={placeholder}
          value={value === null ? "" : String(value)}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9]/g, "");
            onChange(raw === "" ? (label === "Loaded" ? null : 0) : Number(raw));
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="size-12 shrink-0 rounded-xl"
          aria-label={`${label} plus one`}
          disabled={disabled || v >= max}
          onClick={() => onChange(value === null ? 1 : v + 1)}
        >
          <Plus className="size-5" />
        </Button>
      </div>
    </div>
  );
}
