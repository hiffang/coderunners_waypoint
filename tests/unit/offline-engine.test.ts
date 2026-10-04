import { describe, expect, it } from "vitest";
import { backoffDelay, classify, dependentsOf, MAX_BACKOFF_MS, readiness, resolveBody } from "@/lib/offline/engine";
import type { PendingEvent } from "@/lib/offline/types";

const now = Date.parse("2026-09-26T01:00:00Z");

function dep(over: Partial<PendingEvent>): PendingEvent {
  return {
    eventId: "d1",
    scopeKey: "DRIVER:u:v",
    seq: 1,
    userId: "u",
    role: "DRIVER",
    entityType: "Stop",
    entityId: "s1",
    endpoint: "/x",
    method: "POST",
    payload: {},
    baseVersion: 1,
    planRevision: 1,
    dependsOnEventIds: [],
    clientAt: "",
    status: "pending",
    retryCount: 0,
    label: "Arrived at stop 1",
    kind: "stop.arrive",
    meta: {},
    fileRefs: [],
    createdAt: "",
    ...over,
  };
}

describe("classify", () => {
  it("treats no answer as retryable, never as failure", () => {
    expect(classify(null).kind).toBe("retry");
  });
  it("maps statuses to outbox decisions", () => {
    expect(classify(200).kind).toBe("ack");
    expect(classify(401).kind).toBe("auth");
    expect(classify(409, { code: "VERSION_CONFLICT", message: "x" }).kind).toBe("conflict");
    expect(classify(503).kind).toBe("retry");
    expect(classify(500).kind).toBe("retry");
    expect(classify(422).kind).toBe("blocked");
    expect(classify(403).kind).toBe("blocked");
    expect(classify(404).kind).toBe("blocked");
  });
  it("retries a lost serialization race but not an idempotency-key misuse", () => {
    expect(classify(409, { code: "CONFLICT", message: "Concurrent update, please retry" }).kind).toBe("retry");
    expect(classify(409, { code: "CONFLICT", message: "Idempotency key already used for a different request" }).kind).toBe("conflict");
  });
  it("keeps the server error code and message", () => {
    const o = classify(409, { code: "REVISION_CONFLICT", message: "The plan was revised", details: { currentRevision: 2 } });
    expect(o.kind === "conflict" && o.error).toMatchObject({ code: "REVISION_CONFLICT", status: 409, details: { currentRevision: 2 } });
  });
});

describe("backoffDelay", () => {
  it("grows and is bounded", () => {
    const mid = () => 0.5;
    expect(backoffDelay(1, mid)).toBe(2000);
    expect(backoffDelay(3, mid)).toBe(8000);
    expect(backoffDelay(50, () => 1)).toBeLessThanOrEqual(MAX_BACKOFF_MS * 1.25);
  });
});

describe("readiness", () => {
  const event = { entityType: "Stop", entityId: "s1", baseVersion: 2, dependsOnEventIds: ["d1"], nextAttemptAt: undefined, sentBody: undefined };

  it("waits for a pending dependency", () => {
    expect(readiness(event, [dep({ status: "pending" })], { now, manual: false }).kind).toBe("wait");
  });
  it("blocks behind a conflicted or rejected dependency, naming it", () => {
    const r = readiness(event, [dep({ status: "conflict" })], { now, manual: false });
    expect(r.kind).toBe("blocked");
    expect(r.kind === "blocked" && r.error.message).toContain("Arrived at stop 1");
    expect(readiness(event, [undefined], { now, manual: false }).kind).toBe("blocked");
  });
  it("sends when the acknowledged dependency extends the local chain", () => {
    expect(readiness(event, [dep({ status: "acknowledged", result: { version: 2 } })], { now, manual: false }).kind).toBe("ready");
  });
  it("reports a conflict when the server version moved for another reason", () => {
    const r = readiness(event, [dep({ status: "acknowledged", result: { version: 3 } })], { now, manual: false });
    expect(r.kind).toBe("chain-conflict");
  });
  it("never re-derives a frozen body", () => {
    const frozen = { ...event, sentBody: "{}" };
    expect(readiness(frozen, [dep({ status: "acknowledged", result: { version: 9 } })], { now, manual: false }).kind).toBe("ready");
  });
  it("ignores dependencies on other entities for the version check", () => {
    const other = dep({ entityId: "s0", status: "acknowledged", result: { version: 7 } });
    expect(readiness(event, [other], { now, manual: false }).kind).toBe("ready");
  });
  it("honours backoff unless the driver taps Sync now", () => {
    const later = { ...event, dependsOnEventIds: [], nextAttemptAt: now + 10_000 };
    expect(readiness(later, [], { now, manual: false }).kind).toBe("wait");
    expect(readiness(later, [], { now, manual: true }).kind).toBe("ready");
  });
});

describe("resolveBody", () => {
  it("maps client file ids to attachment ids in order", () => {
    const body = resolveBody(
      { outcome: "DELIVERED", evidenceFileIds: [] },
      [
        { clientFileId: "c1", field: "evidenceFileIds" },
        { clientFileId: "c2", field: "evidenceFileIds" },
      ],
      new Map([
        ["c1", "a1"],
        ["c2", "a2"],
      ]),
    );
    expect(body).toEqual({ outcome: "DELIVERED", evidenceFileIds: ["a1", "a2"] });
  });
  it("refuses to build a body before every file is uploaded", () => {
    expect(() => resolveBody({}, [{ clientFileId: "c1", field: "f" }], new Map())).toThrow();
  });
});

describe("dependentsOf", () => {
  it("finds the transitive chain only", () => {
    const events = [
      dep({ eventId: "a", seq: 1 }),
      dep({ eventId: "b", seq: 2, dependsOnEventIds: ["a"] }),
      dep({ eventId: "c", seq: 3, dependsOnEventIds: ["b"] }),
      dep({ eventId: "x", seq: 4, entityId: "s9" }),
    ];
    expect(dependentsOf("a", events).map((e) => e.eventId)).toEqual(["b", "c"]);
    expect(dependentsOf("x", events)).toEqual([]);
  });
});
