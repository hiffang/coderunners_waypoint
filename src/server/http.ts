import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import type { ApiError, ApiErrorCode, FieldErrors } from "@/shared/api";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, "BAD_REQUEST", message, details);
export const unauthorized = () => new HttpError(401, "UNAUTHORIZED", "Sign in required");
export const forbidden = (message = "Not allowed for this account") =>
  new HttpError(403, "FORBIDDEN", message);
export const notFound = (message = "Not found") => new HttpError(404, "NOT_FOUND", message);
export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, "CONFLICT", message, details);
export const versionConflict = (expected: number, actual: number) =>
  new HttpError(409, "VERSION_CONFLICT", "Record changed since you loaded it", {
    expectedVersion: expected,
    currentVersion: actual,
  });
export const revisionConflict = (expected: number, actual: number) =>
  new HttpError(409, "REVISION_CONFLICT", "The plan was revised; refresh the manifest", {
    expectedRevision: expected,
    currentRevision: actual,
  });
/** State machine violation, e.g. depart a trip that is not READY. */
export const invalidTransition = (message: string, details?: unknown) =>
  new HttpError(409, "INVALID_TRANSITION", message, details);
/** Malformed input. */
export const validationError = (message: string, fieldErrors: FieldErrors) =>
  new HttpError(422, "VALIDATION", message, { fieldErrors });
/** Well-formed input that breaks a business rule (capacity, cutoff, quantities). */
export const constraintError = (message: string, details?: unknown) =>
  new HttpError(422, "CONSTRAINT", message, details);
export const unavailable = (message = "Temporarily unavailable, retry") =>
  new HttpError(503, "UNAVAILABLE", message);

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(error: HttpError) {
  const body: ApiError = {
    ok: false,
    error: { code: error.code, message: error.message, details: error.details },
  };
  return NextResponse.json(body, { status: error.status });
}

/** Endpoint placeholder: visible failure, never a fake success. */
export function notImplemented(what: string) {
  return fail(new HttpError(501, "NOT_IMPLEMENTED", `${what} is not implemented yet`));
}

export async function parseJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Body must be valid JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw validationError("Validation failed", toFieldErrors(result.error));
  return result.data;
}

function toFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function parseQuery<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const result = schema.safeParse(params);
  if (!result.success) throw validationError("Invalid query", toFieldErrors(result.error));
  return result.data;
}

/** Reject cross-site mutations. Call on every custom POST/PATCH/PUT/DELETE. */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) throw forbidden("Missing Origin header");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host || new URL(origin).host !== host) throw forbidden("Cross-origin request rejected");
}

/**
 * Wrap a route handler so thrown HttpErrors become standard JSON responses
 * and unexpected errors become a 500 without leaking internals.
 */
export function handle<C>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) return fail(err);
      console.error(err);
      return fail(new HttpError(500, "INTERNAL", "Unexpected server error"));
    }
  };
}
