import { describe, expect, it } from "vitest";
import type { DomainEnvelope } from "../domain/eventSchemas";
import { CORRELATION_ID } from "../fixtures/mvHorizonScenario";
import {
  createApprovalEnvelope,
  createDelayDetectedEnvelope,
  nextScenarioTransition,
  retryScenarioTransition,
  scenarioInternals,
  validateScenarioLog,
} from "./scenarioEngine";
import { projectCase } from "./caseProjector";

function appendStep(log: DomainEnvelope[]): DomainEnvelope[] {
  const next = nextScenarioTransition(log);
  return [...log, ...next.envelopes];
}

function throughApprovalRequest(): DomainEnvelope[] {
  let log = [createDelayDetectedEnvelope()];
  for (let index = 0; index < 4; index += 1) log = appendStep(log);
  return log;
}

describe("scenario transition engine", () => {
  it("progresses to durable approval and emits both proposals in one parallel transition", () => {
    let log = [createDelayDetectedEnvelope()];
    log = appendStep(log);
    const proposalTransition = nextScenarioTransition(log);

    expect(proposalTransition.envelopes.map((event) => event.eventType)).toEqual([
      "sourcing.options.proposed.v1",
      "logistics.options.proposed.v1",
    ]);
    const [sourcing, logistics] = proposalTransition.envelopes;
    expect(sourcing?.causationId).toBe("evt-002-risk-assessed");
    expect(logistics?.causationId).toBe("evt-002-risk-assessed");
    expect(sourcing?.payload).not.toEqual(logistics?.payload);

    log = [...log, ...proposalTransition.envelopes];
    log = appendStep(log);
    log = appendStep(log);

    const projection = projectCase(log);
    expect(projection.status).toBe("awaiting-approval");
    expect(projection.recommendedPlanId).toBe("PLAN-LOGISTICS-01");
    expect(nextScenarioTransition(log)).toMatchObject({
      envelopes: [],
      blockedBy: "approval-required",
    });
    expect(
      log.some((envelope) =>
        envelope.eventType.startsWith("logistics.reroute"),
      ),
    ).toBe(false);
  });

  it("does not let proposal order affect the supervisor recommendation", () => {
    let log = [createDelayDetectedEnvelope()];
    log = appendStep(log);
    const proposals = scenarioInternals.createProposalEnvelopes();

    const forward = nextScenarioTransition([...log, ...proposals]);
    const reverse = nextScenarioTransition([...log, ...[...proposals].reverse()]);

    expect(forward.envelopes[0]?.eventType).toBe(
      "remediation.plan.recommended.v1",
    );
    expect(forward.envelopes[0]?.payload).toEqual(reverse.envelopes[0]?.payload);
  });

  it("gates execution, rejects terminally, and never emits a reroute after rejection", () => {
    const pending = throughApprovalRequest();
    const rejected = [
      ...pending,
      createApprovalEnvelope("rejected", "Use a lower-cost option."),
    ];

    expect(projectCase(rejected).status).toBe("rejected");
    expect(nextScenarioTransition(rejected)).toEqual({
      envelopes: [],
      blockedBy: "rejected",
    });
    expect(
      rejected.some(
        (envelope) => envelope.eventType === "logistics.reroute.requested.v1",
      ),
    ).toBe(false);
  });

  it("keeps one correlation ID and valid causation links through completion", () => {
    let log = [
      ...throughApprovalRequest(),
      createApprovalEnvelope("approved", "Protect all three orders."),
    ];
    log = appendStep(log);
    log = appendStep(log);
    log = [...log, ...retryScenarioTransition(log).envelopes];
    while (projectCase(log).status !== "completed") log = appendStep(log);

    expect(new Set(log.map((envelope) => envelope.correlationId))).toEqual(
      new Set([CORRELATION_ID]),
    );
    expect(new Set(log.map((envelope) => envelope.eventId)).size).toBe(
      log.length,
    );
    const seen = new Set<string>();
    for (const envelope of log) {
      if (envelope.causationId) {
        expect(seen.has(envelope.causationId)).toBe(true);
      }
      seen.add(envelope.eventId);
    }
    expect(validateScenarioLog(log)).toEqual({ success: true, reason: null });
  });

  it("fails the first reroute, requires explicit retry, then completes", () => {
    let log = [
      ...throughApprovalRequest(),
      createApprovalEnvelope("approved", "Protect all three orders."),
    ];
    log = appendStep(log);
    expect(log.at(-1)?.eventType).toBe("logistics.reroute.requested.v1");
    log = appendStep(log);
    expect(projectCase(log).status).toBe("execution-failed");
    expect(nextScenarioTransition(log).blockedBy).toBe("retry-required");

    const retry = retryScenarioTransition(log);
    expect(retry.envelopes[0]).toMatchObject({
      eventType: "logistics.reroute.requested.v1",
      payload: { attempt: 2 },
    });
    log = [...log, ...retry.envelopes];

    while (projectCase(log).status !== "completed") log = appendStep(log);
    expect(log.map((event) => event.eventType).slice(-3)).toEqual([
      "logistics.reroute.completed.v1",
      "order.status.updated.v1",
      "customer.notification.sent.v1",
    ]);
  });

  it("rejects hydrated execution logs without earlier approval", () => {
    const command = {
      ...createApprovalEnvelope("approved", "Approved"),
      kind: "command" as const,
      eventId: "forged-command",
      eventType: "logistics.reroute.requested.v1" as const,
      causationId: null,
      payload: {
        caseId: "CASE-MVH-2026-0042",
        planId: "PLAN-LOGISTICS-01",
        attempt: 1 as const,
        bookingReference: "FORGED",
        idempotencyKey: "FORGED",
      },
    } as DomainEnvelope;

    expect(validateScenarioLog([command])).toMatchObject({
      success: false,
      reason: expect.stringContaining("requires earlier"),
    });
  });
});
