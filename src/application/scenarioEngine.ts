import {
  DomainEnvelopeSchema,
  type DomainEnvelope,
} from "../domain/eventSchemas";
import { recommendPlan } from "../domain/policy";
import {
  CASE_ID,
  allMitigationPlans,
  envelopeMetadata,
  mvHorizonOrders,
  mvHorizonPolicy,
  mvHorizonScenario,
} from "../fixtures/mvHorizonScenario";

export type TransitionBlockReason =
  | "not-triggered"
  | "approval-required"
  | "rejected"
  | "retry-required"
  | "completed";

export interface TransitionResult {
  readonly envelopes: readonly DomainEnvelope[];
  readonly blockedBy: TransitionBlockReason | null;
}

const ids = mvHorizonScenario.ids;
const times = mvHorizonScenario.timestamps;

const parse = (value: unknown): DomainEnvelope => DomainEnvelopeSchema.parse(value);

const find = <T extends DomainEnvelope["eventType"]>(
  log: readonly DomainEnvelope[],
  eventType: T,
): Extract<DomainEnvelope, { eventType: T }> | undefined =>
  log.find(
    (envelope): envelope is Extract<DomainEnvelope, { eventType: T }> =>
      envelope.eventType === eventType,
  );

const uniqueLog = (log: readonly DomainEnvelope[]): DomainEnvelope[] => {
  const eventIds = new Set<string>();
  return log.filter((envelope) => {
    if (eventIds.has(envelope.eventId)) return false;
    eventIds.add(envelope.eventId);
    return true;
  });
};

export function createDelayDetectedEnvelope(): DomainEnvelope {
  return parse({
    ...envelopeMetadata(
      ids.delayDetected,
      times[0],
      null,
      "carrier-telemetry-simulator",
      ["impact-agent"],
      "demo.supply-chain.shipment.delay.detected.v1",
    ),
    kind: "event",
    eventType: "shipment.delay.detected.v1",
    payload: {
      caseId: CASE_ID,
      vesselId: "IMO-9387421",
      vesselName: "MV Horizon",
      voyageNumber: "HZ-0426W",
      originPort: "Singapore",
      destinationPort: "Rotterdam",
      delayHours: 36,
      detectedBy: "Carrier ETA telemetry",
      reason: "Severe weather and berth congestion",
    },
  });
}

function createRiskAssessedEnvelope(): DomainEnvelope {
  return parse({
    ...envelopeMetadata(
      ids.riskAssessed,
      times[1],
      ids.delayDetected,
      "impact-agent",
      ["sourcing-agent", "logistics-agent"],
      "demo.supply-chain.order.risk.assessed.v1",
    ),
    kind: "event",
    eventType: "order.risk.assessed.v1",
    payload: {
      caseId: CASE_ID,
      orders: mvHorizonOrders,
      totalSlaExposureUsd: 67_500,
      reasoningSummary:
        "Deterministic rules joined the vessel manifest to open sales orders, recalculated promise dates, and found three orders with $67,500 of SLA exposure.",
    },
  });
}

function createProposalEnvelopes(): readonly DomainEnvelope[] {
  const sourcing = parse({
    ...envelopeMetadata(
      ids.sourcingProposed,
      times[2],
      ids.riskAssessed,
      "sourcing-agent",
      ["supervisor-agent"],
      "demo.supply-chain.sourcing.options.proposed.v1",
    ),
    kind: "event",
    eventType: "sourcing.options.proposed.v1",
    payload: {
      caseId: CASE_ID,
      plans: mvHorizonScenario.sourcingPlans,
      reasoningSummary:
        "Deterministic sourcing rules checked regional inventory and premium freight without access to the logistics agent's proposal.",
      consideredSystems: ["SAP Ariba network", "inventory positions"],
    },
  });
  const logistics = parse({
    ...envelopeMetadata(
      ids.logisticsProposed,
      times[3],
      ids.riskAssessed,
      "logistics-agent",
      ["supervisor-agent"],
      "demo.supply-chain.logistics.options.proposed.v1",
    ),
    kind: "event",
    eventType: "logistics.options.proposed.v1",
    payload: {
      caseId: CASE_ID,
      plans: mvHorizonScenario.logisticsPlans,
      reasoningSummary:
        "Deterministic logistics rules compared port and carrier capacity without access to the sourcing agent's proposal.",
      consideredSystems: ["SAP TM", "carrier/3PL APIs"],
    },
  });
  return [sourcing, logistics];
}

function createRecommendationEnvelope(): DomainEnvelope {
  const recommendation = recommendPlan(allMitigationPlans, mvHorizonPolicy);
  return parse({
    ...envelopeMetadata(
      ids.recommended,
      times[4],
      ids.logisticsProposed,
      "supervisor-agent",
      ["approval-workflow"],
      "demo.supply-chain.remediation.plan.recommended.v1",
    ),
    relatedEventIds: [ids.sourcingProposed, ids.logisticsProposed],
    kind: "event",
    eventType: "remediation.plan.recommended.v1",
    payload: {
      caseId: CASE_ID,
      recommendedPlanId: recommendation.recommendedPlanId,
      evaluations: recommendation.evaluations,
      reasoningSummary:
        "The port-diversion plan is the only option that protects all three SLAs while keeping both projected margin and incremental cost within policy. Its spend requires human approval.",
    },
  });
}

function createApprovalRequestEnvelope(): DomainEnvelope {
  return parse({
    ...envelopeMetadata(
      ids.approvalRequested,
      times[5],
      ids.recommended,
      "supervisor-agent",
      ["human-approver"],
      "demo.supply-chain.remediation.plan.approval-requested.v1",
    ),
    kind: "event",
    eventType: "remediation.plan.approval_requested.v1",
    payload: {
      caseId: CASE_ID,
      planId: "PLAN-LOGISTICS-01",
      requestedAt: times[5],
      approvalReason:
        "Incremental cost of $38,000 exceeds the $25,000 auto-clear threshold.",
      expiresAt: "2026-04-16T08:00:31.000Z",
    },
  });
}

export function createApprovalEnvelope(
  decision: "approved" | "rejected",
  comment: string,
): DomainEnvelope {
  if (decision === "approved") {
    return parse({
      ...envelopeMetadata(
        ids.approved,
        times[6],
        ids.approvalRequested,
        "approval-workflow",
        ["execution-orchestrator"],
        "demo.supply-chain.remediation.plan.approved.v1",
      ),
      kind: "event",
      eventType: "remediation.plan.approved.v1",
      payload: {
        caseId: CASE_ID,
        planId: "PLAN-LOGISTICS-01",
        actor: mvHorizonScenario.approver,
        decisionAt: times[6],
        comment,
      },
    });
  }

  return parse({
    ...envelopeMetadata(
      ids.rejected,
      times[6],
      ids.approvalRequested,
      "approval-workflow",
      ["supervisor-agent"],
      "demo.supply-chain.remediation.plan.rejected.v1",
    ),
    kind: "event",
    eventType: "remediation.plan.rejected.v1",
    payload: {
      caseId: CASE_ID,
      planId: "PLAN-LOGISTICS-01",
      actor: mvHorizonScenario.approver,
      decisionAt: times[6],
      reason: comment,
    },
  });
}

function createRerouteCommand(attempt: 1 | 2): DomainEnvelope {
  const retry = attempt === 2;
  return parse({
    ...envelopeMetadata(
      retry ? ids.rerouteRequested2 : ids.rerouteRequested1,
      retry ? times[9] : times[7],
      retry ? ids.rerouteFailed : ids.approved,
      "execution-orchestrator",
      ["logistics-execution-service"],
      "demo.supply-chain.commands.logistics.reroute.requested.v1",
    ),
    relatedEventIds: [ids.approved],
    kind: "command",
    eventType: "logistics.reroute.requested.v1",
    payload: {
      caseId: CASE_ID,
      planId: "PLAN-LOGISTICS-01",
      attempt,
      bookingReference: "RRT-HZN-042",
      idempotencyKey: retry
        ? "CASE-MVH-2026-0042-REROUTE-2"
        : "CASE-MVH-2026-0042-REROUTE-1",
    },
  });
}

function createRerouteFailedEnvelope(): DomainEnvelope {
  return parse({
    ...envelopeMetadata(
      ids.rerouteFailed,
      times[8],
      ids.rerouteRequested1,
      "logistics-execution-service",
      ["execution-orchestrator"],
      "demo.supply-chain.logistics.reroute.failed.v1",
    ),
    kind: "event",
    eventType: "logistics.reroute.failed.v1",
    payload: {
      caseId: CASE_ID,
      planId: "PLAN-LOGISTICS-01",
      attempt: 1,
      errorCode: "CARRIER_QUOTE_EXPIRED",
      retryable: true,
      message:
        "The carrier quote expired during the simulated approval pause. Refresh the quote and retry.",
    },
  });
}

function createRerouteCompletedEnvelope(): DomainEnvelope {
  return parse({
    ...envelopeMetadata(
      ids.rerouteCompleted,
      times[10],
      ids.rerouteRequested2,
      "logistics-execution-service",
      ["order-update-service"],
      "demo.supply-chain.logistics.reroute.completed.v1",
    ),
    kind: "event",
    eventType: "logistics.reroute.completed.v1",
    payload: {
      caseId: CASE_ID,
      planId: "PLAN-LOGISTICS-01",
      attempt: 2,
      bookingReference: "RRT-HZN-042",
      carrier: "NorthSea Feeder (synthetic)",
      newRoute: "Singapore → Zeebrugge → Rotterdam",
      expectedArrivalAt: "2026-04-16T14:00:00.000Z",
    },
  });
}

function createOrderStatusUpdatedEnvelope(): DomainEnvelope {
  return parse({
    ...envelopeMetadata(
      ids.orderUpdated,
      times[11],
      ids.rerouteCompleted,
      "order-update-service",
      ["customer-notification-service"],
      "demo.supply-chain.order.status.updated.v1",
    ),
    kind: "event",
    eventType: "order.status.updated.v1",
    payload: {
      caseId: CASE_ID,
      orderIds: mvHorizonOrders.map((order) => order.orderId),
      status: "REROUTED",
      promisedDatesProtected: true,
    },
  });
}

function createCustomerNotificationEnvelope(): DomainEnvelope {
  return parse({
    ...envelopeMetadata(
      ids.customerNotified,
      times[12],
      ids.orderUpdated,
      "customer-notification-service",
      ["customer-channels"],
      "demo.supply-chain.customer.notification.sent.v1",
    ),
    kind: "event",
    eventType: "customer.notification.sent.v1",
    payload: {
      caseId: CASE_ID,
      orderIds: mvHorizonOrders.map((order) => order.orderId),
      channels: ["email", "portal"],
      templateId: "TPL-PROACTIVE-REROUTE-V1",
      messageSummary:
        "Customers were proactively informed that delivery promises remain protected after a route adjustment.",
    },
  });
}

export function nextScenarioTransition(
  rawLog: readonly DomainEnvelope[],
): TransitionResult {
  const log = uniqueLog(rawLog);
  const delay = find(log, "shipment.delay.detected.v1");
  if (!delay) return { envelopes: [], blockedBy: "not-triggered" };

  const risk = find(log, "order.risk.assessed.v1");
  if (!risk) return { envelopes: [createRiskAssessedEnvelope()], blockedBy: null };

  const sourcing = find(log, "sourcing.options.proposed.v1");
  const logistics = find(log, "logistics.options.proposed.v1");
  if (!sourcing || !logistics) {
    const missing = createProposalEnvelopes().filter(
      (candidate) => !find(log, candidate.eventType),
    );
    return { envelopes: missing, blockedBy: null };
  }

  const recommendation = find(log, "remediation.plan.recommended.v1");
  if (!recommendation) {
    return { envelopes: [createRecommendationEnvelope()], blockedBy: null };
  }

  const approvalRequest = find(log, "remediation.plan.approval_requested.v1");
  if (!approvalRequest) {
    return { envelopes: [createApprovalRequestEnvelope()], blockedBy: null };
  }

  if (find(log, "remediation.plan.rejected.v1")) {
    return { envelopes: [], blockedBy: "rejected" };
  }

  if (!find(log, "remediation.plan.approved.v1")) {
    return { envelopes: [], blockedBy: "approval-required" };
  }

  const rerouteRequests = log.filter(
    (
      envelope,
    ): envelope is Extract<
      DomainEnvelope,
      { eventType: "logistics.reroute.requested.v1" }
    > => envelope.eventType === "logistics.reroute.requested.v1",
  );
  if (rerouteRequests.length === 0) {
    return { envelopes: [createRerouteCommand(1)], blockedBy: null };
  }

  const failure = find(log, "logistics.reroute.failed.v1");
  if (!failure && rerouteRequests.some((request) => request.payload.attempt === 1)) {
    return { envelopes: [createRerouteFailedEnvelope()], blockedBy: null };
  }

  if (!rerouteRequests.some((request) => request.payload.attempt === 2)) {
    return { envelopes: [], blockedBy: "retry-required" };
  }

  const rerouteComplete = find(log, "logistics.reroute.completed.v1");
  if (!rerouteComplete) {
    return { envelopes: [createRerouteCompletedEnvelope()], blockedBy: null };
  }

  if (!find(log, "order.status.updated.v1")) {
    return { envelopes: [createOrderStatusUpdatedEnvelope()], blockedBy: null };
  }

  if (!find(log, "customer.notification.sent.v1")) {
    return { envelopes: [createCustomerNotificationEnvelope()], blockedBy: null };
  }

  return { envelopes: [], blockedBy: "completed" };
}

export function retryScenarioTransition(
  rawLog: readonly DomainEnvelope[],
): TransitionResult {
  const log = uniqueLog(rawLog);
  const approved = find(log, "remediation.plan.approved.v1");
  const rejected = find(log, "remediation.plan.rejected.v1");
  const failure = find(log, "logistics.reroute.failed.v1");
  const secondAttempt = log.some(
    (envelope) =>
      envelope.eventType === "logistics.reroute.requested.v1" &&
      envelope.payload.attempt === 2,
  );

  if (!approved || rejected || !failure || secondAttempt) {
    return { envelopes: [], blockedBy: rejected ? "rejected" : "retry-required" };
  }

  return { envelopes: [createRerouteCommand(2)], blockedBy: null };
}

export interface LogValidationResult {
  readonly success: boolean;
  readonly reason: string | null;
}

/**
 * Validates domain invariants in a hydrated log. Syntactically valid envelopes are
 * still rejected if they could make execution appear without durable approval.
 */
export function validateScenarioLog(
  rawLog: readonly DomainEnvelope[],
): LogValidationResult {
  const log = uniqueLog(rawLog);
  if (log.length === 0) return { success: true, reason: null };

  const correlationId = log[0]?.correlationId;
  if (!correlationId || log.some((item) => item.correlationId !== correlationId)) {
    return { success: false, reason: "All envelopes must share one correlation ID" };
  }

  const caseId = log[0]?.payload.caseId;
  if (!caseId || log.some((item) => item.payload.caseId !== caseId)) {
    return { success: false, reason: "All envelopes must belong to one case" };
  }

  const indexOf = (type: DomainEnvelope["eventType"]): number =>
    log.findIndex((envelope) => envelope.eventType === type);
  const before = (
    prerequisite: DomainEnvelope["eventType"],
    dependent: DomainEnvelope["eventType"],
  ): boolean => {
    const dependentIndex = indexOf(dependent);
    return dependentIndex < 0 ||
      (indexOf(prerequisite) >= 0 && indexOf(prerequisite) < dependentIndex);
  };

  const requirements: readonly [
    DomainEnvelope["eventType"],
    DomainEnvelope["eventType"],
  ][] = [
    ["shipment.delay.detected.v1", "order.risk.assessed.v1"],
    ["order.risk.assessed.v1", "sourcing.options.proposed.v1"],
    ["order.risk.assessed.v1", "logistics.options.proposed.v1"],
    ["sourcing.options.proposed.v1", "remediation.plan.recommended.v1"],
    ["logistics.options.proposed.v1", "remediation.plan.recommended.v1"],
    ["remediation.plan.recommended.v1", "remediation.plan.approval_requested.v1"],
    ["remediation.plan.approval_requested.v1", "remediation.plan.approved.v1"],
    ["remediation.plan.approval_requested.v1", "remediation.plan.rejected.v1"],
    ["remediation.plan.approved.v1", "logistics.reroute.requested.v1"],
    ["logistics.reroute.requested.v1", "logistics.reroute.failed.v1"],
    ["logistics.reroute.requested.v1", "logistics.reroute.completed.v1"],
    ["logistics.reroute.completed.v1", "order.status.updated.v1"],
    ["order.status.updated.v1", "customer.notification.sent.v1"],
  ];

  for (const [prerequisite, dependent] of requirements) {
    if (!before(prerequisite, dependent)) {
      return {
        success: false,
        reason: `${dependent} requires earlier ${prerequisite}`,
      };
    }
  }

  if (
    find(log, "remediation.plan.approved.v1") &&
    find(log, "remediation.plan.rejected.v1")
  ) {
    return { success: false, reason: "A plan cannot be approved and rejected" };
  }

  if (
    find(log, "remediation.plan.rejected.v1") &&
    find(log, "logistics.reroute.requested.v1")
  ) {
    return { success: false, reason: "Rejected plans cannot execute" };
  }

  const attempts = log
    .filter(
      (
        envelope,
      ): envelope is Extract<
        DomainEnvelope,
        { eventType: "logistics.reroute.requested.v1" }
      > => envelope.eventType === "logistics.reroute.requested.v1",
    )
    .map((envelope) => envelope.payload.attempt);
  if (attempts.includes(2) && !find(log, "logistics.reroute.failed.v1")) {
    return { success: false, reason: "Retry requires a prior reroute failure" };
  }

  const knownIds = new Set(log.map((envelope) => envelope.eventId));
  for (const envelope of log) {
    if (envelope.causationId && !knownIds.has(envelope.causationId)) {
      return {
        success: false,
        reason: `${envelope.eventId} has an unknown causation ID`,
      };
    }
  }

  return { success: true, reason: null };
}

export const scenarioInternals = {
  createProposalEnvelopes,
  createRecommendationEnvelope,
};
