import type { IssueSeverity, IssueStatus, IssueType, ParkingConstraint, Temp, TripState } from "@/shared/dto/enums";

/** Business time zone (TEAM_CONTRACT section 2). Device time zone is never used for display. */
const TZ = "Asia/Colombo";

export function clock(iso: string | null | undefined) {
  if (!iso) return "--:--";
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

export function dayLabel(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function ago(iso: string | null | undefined) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

export function kg(n: number) {
  return `${n.toLocaleString("en-GB", { maximumFractionDigits: 1 })} kg`;
}

export function m3(n: number) {
  return `${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })} m³`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const TRIP_STATE_LABEL: Record<TripState, string> = {
  PLANNED: "Planned",
  LOADING: "Loading",
  READY: "Ready",
  IN_TRANSIT: "Departed",
  COMPLETED: "Returned",
};

export const ISSUE_TYPE_LABEL: Record<IssueType, string> = {
  SHORTFALL: "Shortfall",
  DAMAGE: "Damage",
  DELAY: "Delay",
  ACCESS: "Access",
  RECEIPT: "Receipt",
  OTHER: "Other",
};

export const SEVERITY_LABEL: Record<IssueSeverity, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };

export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  OPEN: "Dispatcher notified",
  ACKNOWLEDGED: "Acknowledged by dispatcher",
  RESOLVED: "Resolved",
};

/** Handling labels printed on the checklist so the loader keeps goods at the right temperature and stop. */
export const TEMP_HANDLING: Record<Temp, string> = {
  AMBIENT: "Ambient · dry stack",
  CHILLED: "Keep chilled 0–4 °C",
  FROZEN: "Keep frozen",
};

export const PARKING_LABEL: Record<ParkingConstraint, string | null> = {
  NORMAL: null,
  VAN_ONLY: "Van-only access",
  MALL_DOCK: "Mall dock",
};
