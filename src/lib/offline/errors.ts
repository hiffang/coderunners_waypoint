/** Local persistence failed. Never tell the user an action was saved when this is thrown. */
export class OfflineStorageError extends Error {
  constructor(
    public kind: "quota" | "write" | "unavailable",
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "OfflineStorageError";
  }
}

/** purgeScope refused because unsynchronized work would be lost. */
export class UnsyncedWorkError extends Error {
  constructor(public unsettled: number) {
    super(`${unsettled} action${unsettled === 1 ? "" : "s"} not synchronized yet`);
    this.name = "UnsyncedWorkError";
  }
}

function isQuota(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; inner?: unknown; code?: number };
  if (e.name === "QuotaExceededError" || e.code === 22) return true;
  return e.inner ? isQuota(e.inner) : false;
}

export function toStorageError(err: unknown): OfflineStorageError {
  if (err instanceof OfflineStorageError) return err;
  if (isQuota(err)) {
    return new OfflineStorageError(
      "quota",
      "Phone storage is full. Free some space (or remove the photo) and try again. Nothing was saved.",
      err,
    );
  }
  const name = (err as { name?: string })?.name;
  if (name === "MissingAPIError" || name === "OpenFailedError" || name === "InvalidStateError") {
    return new OfflineStorageError(
      "unavailable",
      "This browser is not letting the app store data (private mode?). Nothing was saved.",
      err,
    );
  }
  return new OfflineStorageError("write", "Could not save on this phone. Nothing was saved; try again.", err);
}
