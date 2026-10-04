import "server-only";

/**
 * In-memory fixed-window limiter. Adequate because the deployment is a single
 * app instance; replace with a shared store if the app is ever scaled out.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const t = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= t) {
    buckets.set(key, { count: 1, resetAt: t + windowMs });
    if (buckets.size > 10_000) prune(t);
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

function prune(t: number) {
  for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k);
}
