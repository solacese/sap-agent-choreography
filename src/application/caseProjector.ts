import type {
  ApprovalActor,
  DomainEnvelope,
  MitigationPlan,
  OrderRisk,
  PlanEvaluation,
} from "../domain/eventSchemas";
import { CASE_ID, CORRELATION_ID } from "../fixtures/mvHorizonScenario";

export type ScenarioStatus =
  | "idle"
  | "running"
  | "awaiting-approval"
  | "execution-failed"
  | "rejected"
  | "completed";

export type StageId =
  | "signal"
  | "assess-impact"
  | "explore-options"
  | "decide"
  | "approve"
  | "execute-inform";

export type StageStatus =
  | "waiting"
  | "running"
  | "complete"
  | "approval-required"
  | "failed"
  | "revision-needed";

export interface StageProjection {
  readonly id: StageId;
  readonly number: number;
  readonly label: string;
  readonly status: StageStatus;
}

export type AgentState = "waiting" | "running" | "complete";

export interface AgentProjection {
  readonly state: AgentState;
  readonly inputs: readonly string[];
  readonly reasoningSummary: string | null;
  readonly outputIds: readonly string[];
}

export interface ApprovalProjection {
  readonly status: "not-requested" | "pending" | "approved" | "rejected";
  readonly planId: string | null;
  readonly requestedAt: string | null;
  readonly expiresAt: string | null;
  readonly actor: ApprovalActor | null;
  readonly decidedAt: string | null;
  readonly comment: string | null;
}

export interface ExecutionStepProjection {
  readonly id: "reroute" | "order-update" | "customer-notification";
  readonly label: string;
  readonly status: "waiting" | "running" | "complete" | "failed";
  readonly detail: string | null;
}

export interface AuditRecord {
  readonly eventId: string;
  readonly eventType: DomainEnvelope["eventType"];
  readonly occurredAt: string;
  readonly producer: string;
  readonly summary: string;
}

export interface CaseProjection {
  readonly caseId: string;
  readonly correlationId: string;
  readonly status: ScenarioStatus;
  readonly stages: readonly StageProjection[];
  readonly agents: Readonly<{
    impact: AgentProjection;
    sourcing: AgentProjection;
    logistics: AgentProjection;
    supervisor: AgentProjection;
  }>;
  readonly orders: readonly OrderRisk[];
  readonly plans: readonly MitigationPlan[];
  readonly evaluations: readonly PlanEvaluation[];
  readonly recommendedPlanId: string | null;
  readonly approval: ApprovalProjection;
  readonly execution: readonly ExecutionStepProjection[];
  readonly audit: readonly AuditRecord[];
  readonly processedEventIds: ReadonlySet<string>;
  readonly duplicateEventIds: readonly string[];
}

const hasType = (
  log: readonly DomainEnvelope[],
  type: DomainEnvelope["eventType"],
): boolean => log.some((envelope) => envelope.eventType === type);

const latestOfType = <T extends DomainEnvelope["eventType"]>(
  log: readonly DomainEnvelope[],
  type: T,
): Extract<DomainEnvelope, { eventType: T }> | undefined =>
  log.findLast(
    (envelope): envelope is Extract<DomainEnvelope, { eventType: T }> =>
      envelope.eventType === type,
  );

function deduplicate(log: readonly DomainEnvelope[]): {
  unique: DomainEnvelope[];
  processed: Set<string>;
  duplicates: string[];
} {
  const unique: DomainEnvelope[] = [];
  const processed = new Set<string>();
  const duplicates: string[] = [];

  for (const envelope of log) {
    if (processed.has(envelope.eventId)) {
      duplicates.push(envelope.eventId);
      continue;
    }
    processed.add(envelope.eventId);
    unique.push(envelope);
  }

  return { unique, processed, duplicates };
}

function auditSummary(envelope: DomainEnvelope): string {
  switch (envelope.eventType) {
    case "shipment.delay.detected.v1":
      return `${envelope.payload.vesselName} delay detected (${envelope.payload.delayHours}h)`;
    case "order.risk.assessed.v1":
      return `${envelope.payload.orders.length} orders assessed at risk`;
    case "sourcing.options.proposed.v1":
    case "logistics.options.proposed.v1":
      return `${envelope.payload.plans.length} mitigation option${envelope.payload.plans.length === 1 ? "" : "s"} proposed`;
    case "remediation.plan.recommended.v1":
      return `${envelope.payload.recommendedPlanId} recommended`;
    case "remediation.plan.approval_requested.v1":
      return `Approval requested for ${envelope.payload.planId}`;
    case "remediation.plan.approved.v1":
      return `${envelope.payload.planId} approved by ${envelope.payload.actor.displayName}`;
    case "remediation.plan.rejected.v1":
      return `${envelope.payload.planId} rejected by ${envelope.payload.actor.displayName}`;
    case "logistics.reroute.requested.v1":
      return `Reroute attempt ${envelope.payload.attempt} requested`;
    case "logistics.reroute.failed.v1":
      return `Reroute failed: ${envelope.payload.errorCode}`;
    case "logistics.reroute.completed.v1":
      return `Reroute booked with ${envelope.payload.carrier}`;
    case "order.status.updated.v1":
      return `${envelope.payload.orderIds.length} order statuses updated`;
    case "customer.notification.sent.v1":
      return `${envelope.payload.orderIds.length} customers notified`;
  }
}

export function projectCase(rawLog: readonly DomainEnvelope[]): CaseProjection {
  const { unique: log, processed, duplicates } = deduplicate(rawLog);

  const delay = latestOfType(log, "shipment.delay.detected.v1");
  const risk = latestOfType(log, "order.risk.assessed.v1");
  const sourcing = latestOfType(log, "sourcing.options.proposed.v1");
  const logistics = latestOfType(log, "logistics.options.proposed.v1");
  const recommendation = latestOfType(log, "remediation.plan.recommended.v1");
  const approvalRequest = latestOfType(
    log,
    "remediation.plan.approval_requested.v1",
  );
  const approved = latestOfType(log, "remediation.plan.approved.v1");
  const rejected = latestOfType(log, "remediation.plan.rejected.v1");
  const rerouteRequest = latestOfType(log, "logistics.reroute.requested.v1");
  const rerouteFailure = latestOfType(log, "logistics.reroute.failed.v1");
  const rerouteComplete = latestOfType(log, "logistics.reroute.completed.v1");
  const orderUpdate = latestOfType(log, "order.status.updated.v1");
  const notification = latestOfType(log, "customer.notification.sent.v1");

  const status: ScenarioStatus = notification
    ? "completed"
    : rejected
      ? "rejected"
      : rerouteFailure && (!rerouteRequest || rerouteRequest.payload.attempt === 1)
        ? "execution-failed"
        : approvalRequest && !approved
          ? "awaiting-approval"
          : log.length === 0
            ? "idle"
            : "running";

  const proposalCount = Number(Boolean(sourcing)) + Number(Boolean(logistics));
  const executionStarted = Boolean(rerouteRequest);

  const stages: StageProjection[] = [
    {
      id: "signal",
      number: 1,
      label: "Signal",
      status: delay ? "complete" : "waiting",
    },
    {
      id: "assess-impact",
      number: 2,
      label: "Assess impact",
      status: risk ? "complete" : delay ? "running" : "waiting",
    },
    {
      id: "explore-options",
      number: 3,
      label: "Explore options",
      status:
        proposalCount === 2
          ? "complete"
          : risk
            ? "running"
            : "waiting",
    },
    {
      id: "decide",
      number: 4,
      label: "Decide",
      status: recommendation
        ? "complete"
        : proposalCount === 2
          ? "running"
          : "waiting",
    },
    {
      id: "approve",
      number: 5,
      label: "Approve",
      status: rejected
        ? "revision-needed"
        : approved
          ? "complete"
          : approvalRequest
            ? "approval-required"
            : recommendation
              ? "running"
              : "waiting",
    },
    {
      id: "execute-inform",
      number: 6,
      label: "Execute and inform",
      status: notification
        ? "complete"
        : rerouteFailure &&
            (!rerouteRequest || rerouteRequest.payload.attempt === 1)
          ? "failed"
          : executionStarted
            ? "running"
            : "waiting",
    },
  ];

  const approval: ApprovalProjection = rejected
    ? {
        status: "rejected",
        planId: rejected.payload.planId,
        requestedAt: approvalRequest?.payload.requestedAt ?? null,
        expiresAt: approvalRequest?.payload.expiresAt ?? null,
        actor: rejected.payload.actor,
        decidedAt: rejected.payload.decisionAt,
        comment: rejected.payload.reason,
      }
    : approved
      ? {
          status: "approved",
          planId: approved.payload.planId,
          requestedAt: approvalRequest?.payload.requestedAt ?? null,
          expiresAt: approvalRequest?.payload.expiresAt ?? null,
          actor: approved.payload.actor,
          decidedAt: approved.payload.decisionAt,
          comment: approved.payload.comment,
        }
      : approvalRequest
        ? {
            status: "pending",
            planId: approvalRequest.payload.planId,
            requestedAt: approvalRequest.payload.requestedAt,
            expiresAt: approvalRequest.payload.expiresAt,
            actor: null,
            decidedAt: null,
            comment: null,
          }
        : {
            status: "not-requested",
            planId: null,
            requestedAt: null,
            expiresAt: null,
            actor: null,
            decidedAt: null,
            comment: null,
          };

  const plans = [...(sourcing?.payload.plans ?? []), ...(logistics?.payload.plans ?? [])];

  const execution: ExecutionStepProjection[] = [
    {
      id: "reroute",
      label: "Reroute booking",
      status: rerouteComplete
        ? "complete"
        : rerouteFailure &&
            (!rerouteRequest || rerouteRequest.payload.attempt === 1)
          ? "failed"
          : rerouteRequest
            ? "running"
            : "waiting",
      detail: rerouteComplete
        ? `${rerouteComplete.payload.bookingReference} · ${rerouteComplete.payload.newRoute}`
        : rerouteFailure
          ? rerouteFailure.payload.message
          : rerouteRequest
            ? `Attempt ${rerouteRequest.payload.attempt}`
            : null,
    },
    {
      id: "order-update",
      label: "Order update",
      status: orderUpdate ? "complete" : rerouteComplete ? "running" : "waiting",
      detail: orderUpdate
        ? `${orderUpdate.payload.orderIds.length} orders marked REROUTED`
        : null,
    },
    {
      id: "customer-notification",
      label: "Customer notification",
      status: notification ? "complete" : orderUpdate ? "running" : "waiting",
      detail: notification
        ? `${notification.payload.orderIds.length} notifications sent`
        : null,
    },
  ];

  return {
    caseId: delay?.payload.caseId ?? CASE_ID,
    correlationId: delay?.correlationId ?? CORRELATION_ID,
    status,
    stages,
    agents: {
      impact: {
        state: risk ? "complete" : delay ? "running" : "waiting",
        inputs: delay ? [delay.eventId, "S/4HANA order book", "SAP Datasphere"] : [],
        reasoningSummary: risk?.payload.reasoningSummary ?? null,
        outputIds: risk ? risk.payload.orders.map((order) => order.orderId) : [],
      },
      sourcing: {
        state: sourcing ? "complete" : risk ? "running" : "waiting",
        inputs: risk ? [risk.eventId, "SAP Ariba network", "inventory positions"] : [],
        reasoningSummary: sourcing?.payload.reasoningSummary ?? null,
        outputIds: sourcing?.payload.plans.map((plan) => plan.planId) ?? [],
      },
      logistics: {
        state: logistics ? "complete" : risk ? "running" : "waiting",
        inputs: risk ? [risk.eventId, "carrier/3PL APIs", "SAP TM"] : [],
        reasoningSummary: logistics?.payload.reasoningSummary ?? null,
        outputIds: logistics?.payload.plans.map((plan) => plan.planId) ?? [],
      },
      supervisor: {
        state: recommendation
          ? "complete"
          : proposalCount === 2
            ? "running"
            : "waiting",
        inputs:
          proposalCount === 2 && sourcing && logistics
            ? [sourcing.eventId, logistics.eventId, "margin and SLA policy"]
            : [],
        reasoningSummary: recommendation?.payload.reasoningSummary ?? null,
        outputIds: recommendation ? [recommendation.payload.recommendedPlanId] : [],
      },
    },
    orders: risk?.payload.orders ?? [],
    plans,
    evaluations: recommendation?.payload.evaluations ?? [],
    recommendedPlanId: recommendation?.payload.recommendedPlanId ?? null,
    approval,
    execution,
    audit: log.map((envelope) => ({
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      occurredAt: envelope.occurredAt,
      producer: envelope.producer,
      summary: auditSummary(envelope),
    })),
    processedEventIds: processed,
    duplicateEventIds: duplicates,
  };
}

export function hasExecuted(log: readonly DomainEnvelope[]): boolean {
  return hasType(log, "logistics.reroute.requested.v1");
}
