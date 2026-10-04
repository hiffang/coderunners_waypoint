// Pure release rules shared by the ready endpoint, the trip list and the
// manifest. The server is the only caller that decides; the UI shows the result.
import { REFRIGERATED_TEMPS } from "@/shared/dto/enums";
import type { IssueDto } from "@/shared/dto/issue";
import type { ManifestDto, ManifestLineDto } from "@/shared/dto/manifest";
import type { LoadingReadiness } from "./types";

type ReadinessInput = Pick<ManifestDto, "state" | "planRevision" | "refrigerated" | "stops"> & {
  issues: Array<Pick<IssueDto, "blocking" | "status">>;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A line is verified when its check matches the current revision and every unit is loaded undamaged. */
export function lineStatus(line: Pick<ManifestLineDto, "expectedUnits" | "check">, planRevision: number) {
  const c = line.check;
  if (!c) return "unchecked" as const;
  if (c.planRevision !== planRevision) return "stale" as const;
  if (c.loadedUnits < line.expectedUnits) return "short" as const;
  if (c.damageUnits > 0) return "damaged" as const;
  return "ok" as const;
}

export function loadingReadiness(m: ReadinessInput): LoadingReadiness {
  const lines = m.stops.flatMap((s) => s.orders.flatMap((o) => o.lines));
  const status = lines.map((l) => lineStatus(l, m.planRevision));
  const count = (s: ReturnType<typeof lineStatus>) => status.filter((x) => x === s).length;
  const unchecked = count("unchecked");
  const staleLines = count("stale");
  const shortLines = count("short");
  const damagedLines = count("damaged");
  const openBlockingIssues = m.issues.filter((i) => i.blocking && i.status !== "RESOLVED").length;
  const coldOnAmbient =
    !m.refrigerated && m.stops.some((s) => s.orders.some((o) => REFRIGERATED_TEMPS.includes(o.temp)));

  const blockers: string[] = [];
  if (m.state === "PLANNED") blockers.push("Loading has not started yet");
  if (m.state === "READY") blockers.push("Trip is already released to the driver");
  if (m.state === "IN_TRANSIT" || m.state === "COMPLETED") blockers.push("Trip has already departed");
  if (unchecked > 0) blockers.push(`${plural(unchecked, "line")} not checked yet`);
  if (staleLines > 0) blockers.push(`${plural(staleLines, "line")} checked against an older plan revision; check again for revision ${m.planRevision}`);
  if (shortLines > 0) blockers.push(`${plural(shortLines, "line")} loaded short`);
  if (damagedLines > 0) blockers.push(`${plural(damagedLines, "line")} with damaged units`);
  if (coldOnAmbient) blockers.push("Chilled goods are planned on a vehicle without refrigeration");
  if (openBlockingIssues > 0) blockers.push(`${plural(openBlockingIssues, "shortfall/damage issue")} not resolved`);

  return {
    canRelease: m.state === "LOADING" && blockers.length === 0,
    blockers,
    totalLines: lines.length,
    checkedLines: lines.length - unchecked - staleLines,
    staleLines,
    shortLines,
    damagedLines,
    openBlockingIssues,
  };
}
