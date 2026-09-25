import { describe, expect, it, vi } from "vitest";
import { LocalStorageCaseRepository } from "../adapters/LocalStorageCaseRepository";
import type { StorageLike } from "../adapters/LocalStorageCaseRepository";
import { CASE_ID } from "../fixtures/mvHorizonScenario";
import { ScenarioRuntime } from "./scenarioRuntime";

class RuntimeStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

async function advanceToApproval(runtime: ScenarioRuntime): Promise<void> {
  await runtime.trigger();
  await runtime.step();
  await runtime.step();
  await runtime.step();
  await runtime.step();
}

describe("ScenarioRuntime", () => {
  it("runs trigger, step, approval, failure, explicit retry, and completion actions", async () => {
    const runtime = new ScenarioRuntime({
      repository: new LocalStorageCaseRepository(
        new RuntimeStorage(),
        "runtime-actions",
      ),
    });
    const listener = vi.fn();
    const unsubscribe = runtime.subscribe(listener);

    expect(await runtime.step()).toMatchObject({
      accepted: false,
      reason: "not-triggered",
    });
    expect(await runtime.trigger()).toMatchObject({
      accepted: true,
      reason: null,
    });
    expect(await runtime.trigger()).toMatchObject({
      accepted: false,
      reason: "invalid-action",
    });

    expect(await runtime.step()).toMatchObject({ accepted: true });
    const proposals = await runtime.step();
    expect(proposals.accepted).toBe(true);
    expect(proposals.receipts).toHaveLength(2);
    expect(await runtime.step()).toMatchObject({ accepted: true });
    expect(await runtime.step()).toMatchObject({ accepted: true });

    expect(runtime.getSnapshot().projection.status).toBe("awaiting-approval");
    expect(runtime.getSnapshot().capabilities).toMatchObject({
      canStep: false,
      canApprove: true,
      canReject: true,
    });
    expect(await runtime.step()).toMatchObject({
      accepted: false,
      reason: "approval-required",
    });
    expect(await runtime.approve("Protect all three orders.")).toMatchObject({
      accepted: true,
      reason: null,
    });
    expect(await runtime.approve()).toMatchObject({
      accepted: false,
      reason: "invalid-action",
    });

    expect(await runtime.step()).toMatchObject({ accepted: true });
    expect(await runtime.step()).toMatchObject({ accepted: true });
    expect(runtime.getSnapshot().projection.status).toBe("execution-failed");
    expect(runtime.getSnapshot().capabilities.canRetry).toBe(true);
    expect(await runtime.step()).toMatchObject({
      accepted: false,
      reason: "retry-required",
    });
    expect(await runtime.retry()).toMatchObject({
      accepted: true,
      reason: null,
    });
    expect(await runtime.retry()).toMatchObject({
      accepted: false,
      reason: "retry-required",
    });

    while (runtime.getSnapshot().projection.status !== "completed") {
      expect(await runtime.step()).toMatchObject({ accepted: true });
    }
    expect(await runtime.step()).toMatchObject({
      accepted: false,
      reason: "completed",
    });
    expect(runtime.getSnapshot().projection.execution).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "reroute", status: "complete" }),
        expect.objectContaining({ id: "order-update", status: "complete" }),
        expect.objectContaining({
          id: "customer-notification",
          status: "complete",
        }),
      ]),
    );
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    runtime.dispose();
  });

  it("hydrates the persisted approval gate after a browser refresh", async () => {
    const storage = new RuntimeStorage();
    const prefix = "runtime-refresh";
    const firstRuntime = new ScenarioRuntime({
      repository: new LocalStorageCaseRepository(storage, prefix),
    });
    await advanceToApproval(firstRuntime);
    const beforeRefresh = firstRuntime.getSnapshot();
    expect(storage.getItem(`${prefix}:case:${CASE_ID}`)).not.toBeNull();
    firstRuntime.dispose();

    const refreshedRuntime = new ScenarioRuntime({
      repository: new LocalStorageCaseRepository(storage, prefix),
    });
    const hydrated = refreshedRuntime.getSnapshot();
    expect(hydrated.envelopes).toEqual(beforeRefresh.envelopes);
    expect(hydrated.projection).toEqual(beforeRefresh.projection);
    expect(hydrated.projection.status).toBe("awaiting-approval");
    expect(hydrated.lastActivity).toMatchObject({
      action: "hydrate",
      envelopeIds: beforeRefresh.envelopes.map((envelope) => envelope.eventId),
    });

    expect(await refreshedRuntime.approve()).toMatchObject({ accepted: true });
    expect(await refreshedRuntime.step()).toMatchObject({ accepted: true });
    refreshedRuntime.dispose();
  });

  it("replays the log without changing it and suppresses duplicate delivery", async () => {
    const storage = new RuntimeStorage();
    const runtime = new ScenarioRuntime({
      repository: new LocalStorageCaseRepository(storage, "runtime-replay"),
    });
    await runtime.trigger();
    await runtime.step();

    const before = runtime.getSnapshot();
    const replay = runtime.replayLog();
    const afterReplay = runtime.getSnapshot();
    expect(replay).toEqual({ accepted: true, reason: null, receipts: [] });
    expect(afterReplay.envelopes).toEqual(before.envelopes);
    expect(afterReplay.projection).toEqual(before.projection);
    expect(afterReplay.lastActivity).toMatchObject({ action: "replay-log" });

    const eventId = afterReplay.envelopes[0]!.eventId;
    const delivery = await runtime.replayDelivery(eventId);
    expect(delivery).toMatchObject({
      accepted: true,
      reason: null,
      receipts: [{ delivered: false, duplicate: true }],
    });
    expect(runtime.getSnapshot().envelopes).toEqual(before.envelopes);
    expect(runtime.getSnapshot().projection).toEqual(before.projection);
    expect(runtime.getSnapshot().lastActivity).toMatchObject({
      action: "replay-delivery",
      envelopeIds: [eventId],
      duplicate: true,
    });
    expect(await runtime.replayDelivery("missing-event")).toMatchObject({
      accepted: false,
      reason: "invalid-action",
    });
    runtime.dispose();
  });

  it("seeds duplicate suppression when replaying a hydrated delivery", async () => {
    const storage = new RuntimeStorage();
    const prefix = "runtime-hydrated-replay";
    const firstRuntime = new ScenarioRuntime({
      repository: new LocalStorageCaseRepository(storage, prefix),
    });
    await firstRuntime.trigger();
    const eventId = firstRuntime.getSnapshot().envelopes[0]!.eventId;
    firstRuntime.dispose();

    const refreshedRuntime = new ScenarioRuntime({
      repository: new LocalStorageCaseRepository(storage, prefix),
    });
    const delivery = await refreshedRuntime.replayDelivery(eventId);

    expect(delivery.receipts[0]).toMatchObject({
      envelopeId: eventId,
      delivered: false,
      duplicate: true,
    });
    expect(refreshedRuntime.getSnapshot().envelopes).toHaveLength(1);
    refreshedRuntime.dispose();
  });

  it("resets the log, transport duplicate tracking, and persistent record", async () => {
    const storage = new RuntimeStorage();
    const prefix = "runtime-reset";
    const runtime = new ScenarioRuntime({
      repository: new LocalStorageCaseRepository(storage, prefix),
    });
    await runtime.trigger();
    expect(runtime.getSnapshot().envelopes).toHaveLength(1);

    expect(runtime.reset()).toEqual({
      accepted: true,
      reason: null,
      receipts: [],
    });
    expect(runtime.getSnapshot().projection.status).toBe("idle");
    expect(runtime.getSnapshot().capabilities.canTrigger).toBe(true);
    expect(
      new LocalStorageCaseRepository(storage, prefix).load(CASE_ID),
    ).toBeNull();

    expect(await runtime.trigger()).toMatchObject({ accepted: true });
    expect(runtime.getSnapshot().envelopes).toHaveLength(1);
    runtime.dispose();
  });

  it("records rejection as terminal with no execution envelopes", async () => {
    const runtime = new ScenarioRuntime({
      repository: new LocalStorageCaseRepository(
        new RuntimeStorage(),
        "runtime-reject",
      ),
    });
    await advanceToApproval(runtime);
    expect(await runtime.reject("Margin risk needs review.")).toMatchObject({
      accepted: true,
      reason: null,
    });
    expect(await runtime.reject()).toMatchObject({
      accepted: false,
      reason: "invalid-action",
    });

    expect(runtime.getSnapshot().projection.status).toBe("rejected");
    expect(runtime.getSnapshot().projection.approval.comment).toBe(
      "Margin risk needs review.",
    );
    expect(
      runtime
        .getSnapshot()
        .envelopes.some(
          (envelope) =>
            envelope.eventType === "logistics.reroute.requested.v1",
        ),
    ).toBe(false);
    expect(await runtime.step()).toMatchObject({
      accepted: false,
      reason: "rejected",
    });
    expect(await runtime.retry()).toMatchObject({
      accepted: false,
      reason: "rejected",
    });
    runtime.dispose();
  });
});
