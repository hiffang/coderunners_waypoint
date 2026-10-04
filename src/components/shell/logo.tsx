export function Logo() {
  return (
    <span className="flex items-center gap-2 font-semibold text-lg tracking-tight">
      <svg viewBox="0 0 28 28" className="size-7" aria-hidden>
        <rect width="28" height="28" rx="6" fill="var(--ink)" />
        <path d="M7 20 L12 12 L16 16 L21 8" stroke="var(--lime)" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="21" cy="8" r="2.5" fill="var(--lime)" />
      </svg>
      Waypoint
    </span>
  );
}
