import type { StopState, TripState } from "@/shared/dto/enums";

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

export const TRIP_STATE_LABEL: Record<TripState, string> = {
  PLANNED: "Planned",
  LOADING: "Loading",
  READY: "Released",
  IN_TRANSIT: "On the road",
  COMPLETED: "Returned",
};

export const STOP_STATE_LABEL: Record<StopState, string> = {
  PENDING: "Not reached",
  ARRIVED: "Arrived",
  DELIVERED: "Delivered",
  PARTIAL: "Partly delivered",
  FAILED: "Failed",
};
