// Response envelope shared by every API route and client fetcher.
//
// Success: { ok: true, data }. Lists: data = { items, nextCursor }.
// Error:   { ok: false, error: { code, message, details? } }
//   401 UNAUTHORIZED, 403 FORBIDDEN, 404 NOT_FOUND (missing or not visible),
//   409 VERSION_CONFLICT (details.currentVersion) / REVISION_CONFLICT (details.currentRevision)
//       / INVALID_TRANSITION / CONFLICT (idempotency key reuse),
//   422 VALIDATION (details.fieldErrors) / CONSTRAINT (business rule, details explains),
//   503 UNAVAILABLE (retryable), 501 NOT_IMPLEMENTED.

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VERSION_CONFLICT"
  | "REVISION_CONFLICT"
  | "INVALID_TRANSITION"
  | "VALIDATION"
  | "CONSTRAINT"
  | "RATE_LIMITED"
  | "NOT_IMPLEMENTED"
  | "UNAVAILABLE"
  | "INTERNAL";

export type ApiOk<T> = { ok: true; data: T };
export type ApiError = {
  ok: false;
  error: { code: ApiErrorCode; message: string; details?: unknown };
};
export type ApiResult<T> = ApiOk<T> | ApiError;

export type Page<T> = { items: T[]; nextCursor: string | null };

/** details for 422 VALIDATION */
export type FieldErrors = Record<string, string[]>;

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Header carrying a client-generated key for retry-safe mutations. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

export async function apiFetch<T>(
  input: string,
  init?: RequestInit & { idempotencyKey?: string },
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (init?.idempotencyKey) headers.set(IDEMPOTENCY_HEADER, init.idempotencyKey);
  const res = await fetch(input, { ...init, headers });
  const body = (await res.json().catch(() => null)) as ApiResult<T> | null;
  if (!body) throw new ApiClientError(res.status, "INTERNAL", `HTTP ${res.status}`);
  if (!body.ok) {
    throw new ApiClientError(res.status, body.error.code, body.error.message, body.error.details);
  }
  return body.data;
}
