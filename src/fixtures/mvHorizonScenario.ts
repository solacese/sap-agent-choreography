import type {
  ApprovalActor,
  DomainEnvelope,
  MitigationPlan,
  OrderRisk,
} from "../domain/eventSchemas";
import type { PolicyThresholds } from "../domain/policy";

export const MV_HORIZON_FIXTURE_VERSION = 1 as const;
export const CASE_ID = "CASE-MVH-2026-0042";
export const CORRELATION_ID = "corr-mv-horizon-2026-0042";

const timeline = [
  "2026-04-14T08:00:00.000Z",
  "2026-04-14T08:00:10.000Z",
  "2026-04-14T08:00:20.000Z",
  "2026-04-14T08:00:21.000Z",
  "2026-04-14T08:00:30.000Z",
  "2026-04-14T08:00:31.000Z",
  "2026-04-14T12:15:00.000Z",
  "2026-04-14T12:15:10.000Z",
  "2026-04-14T12:15:20.000Z",
  "2026-04-14T12:16:00.000Z",
  "2026-04-14T12:16:10.000Z",
  "2026-04-14T12:16:20.000Z",
  "2026-04-14T12:16:30.000Z",
] as const;

export const mvHorizonOrders: readonly OrderRisk[] = [
  {
    orderId: "SO-471100",
    customerName: "Helios Medical Systems",
    customerTier: "PLATINUM",
    destination: "Rotterdam, NL",
    orderValueUsd: 485_000,
    promisedDeliveryAt: "2026-04-16T16:00:00.000Z",
    projectedDeliveryAt: "2026-04-18T04:00:00.000Z",
    projectedDelayHours: 36,
    slaExposureUsd: 30_000,
  },
  {
    orderId: "SO-471128",
    customerName: "Nordwerk Automotive",
    customerTier: "GOLD",
    destination: "Hamburg, DE",
    orderValueUsd: 310_000,
    promisedDeliveryAt: "2026-04-17T10:00:00.000Z",
    projectedDeliveryAt: "2026-04-18T22:00:00.000Z",
    projectedDelayHours: 36,
    slaExposureUsd: 22_500,
  },
  {
    orderId: "SO-471141",
    customerName: "Aster Retail Group",
    customerTier: "SILVER",
    destination: "Antwerp, BE",
    orderValueUsd: 190_000,
    promisedDeliveryAt: "2026-04-18T12:00:00.000Z",
    projectedDeliveryAt: "2026-04-20T00:00:00.000Z",
    projectedDelayHours: 36,
    slaExposureUsd: 15_000,
  },
] as const;

export const sourcingPlans: readonly MitigationPlan[] = [
  {
    planId: "PLAN-SOURCE-01",
    source: "sourcing",
    title: "Reallocate regional safety stock",
    summary:
      "Fulfil the two priority orders from Benelux inventory while the vessel completes its delayed voyage.",
    etaRecoveryHours: 30,
    incrementalCostUsd: 12_000,
    projectedMarginPercent: 19.4,
    ordersMeetingSla: 2,
    totalOrders: 3,
    executionMode: "inventory-reallocation",
  },
  {
    planId: "PLAN-SOURCE-02",
    source: "sourcing",
    title: "Expedite critical units by air",
    summary:
      "Move critical components by air and leave standard inventory on MV Horizon.",
    etaRecoveryHours: 36,
    incrementalCostUsd: 58_000,
    projectedMarginPercent: 13.2,
    ordersMeetingSla: 3,
    totalOrders: 3,
    executionMode: "airfreight",
  },
] as const;

export const logisticsPlans: readonly MitigationPlan[] = [
  {
    planId: "PLAN-LOGISTICS-01",
    source: "logistics",
    title: "Divert via Zeebrugge express connection",
    summary:
      "Transfer at Zeebrugge to a priority feeder and use dedicated final-mile capacity.",
    etaRecoveryHours: 34,
    incrementalCostUsd: 38_000,
    projectedMarginPercent: 16.8,
    ordersMeetingSla: 3,
    totalOrders: 3,
    executionMode: "port-diversion",
  },
] as const;

export const allMitigationPlans: readonly MitigationPlan[] = [
  ...sourcingPlans,
  ...logisticsPlans,
];

export const mvHorizonPolicy: PolicyThresholds = {
  minimumMarginPercent: 15,
  maximumIncrementalCostUsd: 45_000,
  humanApprovalCostUsd: 25_000,
  minimumOrdersMeetingSla: 3,
};

export const syntheticApprover: ApprovalActor = {
  actorId: "USER-ANIKA-SHAH",
  displayName: "Anika Shah",
  channel: "Joule",
};

const metadata = (
  eventId: string,
  occurredAt: string,
  causationId: string | null,
  producer: string,
  consumers: string[],
  topic: string,
): Pick<
  DomainEnvelope,
  | "eventId"
  | "schemaVersion"
  | "occurredAt"
  | "correlationId"
  | "causationId"
  | "relatedEventIds"
  | "producer"
  | "consumers"
  | "topic"
> => ({
  eventId,
  schemaVersion: "1.0",
  occurredAt,
  correlationId: CORRELATION_ID,
  causationId,
  relatedEventIds: [],
  producer,
  consumers,
  topic,
});

export const MV_HORIZON_IDS = {
  delayDetected: "evt-001-delay-detected",
  riskAssessed: "evt-002-risk-assessed",
  sourcingProposed: "evt-003-sourcing-proposed",
  logisticsProposed: "evt-004-logistics-proposed",
  recommended: "evt-005-plan-recommended",
  approvalRequested: "evt-006-approval-requested",
  approved: "evt-007-plan-approved",
  rejected: "evt-007-plan-rejected",
  rerouteRequested1: "cmd-008-reroute-requested-1",
  rerouteFailed: "evt-009-reroute-failed",
  rerouteRequested2: "cmd-010-reroute-requested-2",
  rerouteCompleted: "evt-011-reroute-completed",
  orderUpdated: "evt-012-order-status-updated",
  customerNotified: "evt-013-customer-notified",
} as const;

export interface ScenarioFixture {
  readonly version: typeof MV_HORIZON_FIXTURE_VERSION;
  readonly caseId: typeof CASE_ID;
  readonly correlationId: typeof CORRELATION_ID;
  readonly orders: readonly OrderRisk[];
  readonly sourcingPlans: readonly MitigationPlan[];
  readonly logisticsPlans: readonly MitigationPlan[];
  readonly policy: PolicyThresholds;
  readonly approver: ApprovalActor;
  readonly timestamps: typeof timeline;
  readonly ids: typeof MV_HORIZON_IDS;
}

export const mvHorizonScenario: ScenarioFixture = {
  version: MV_HORIZON_FIXTURE_VERSION,
  caseId: CASE_ID,
  correlationId: CORRELATION_ID,
  orders: mvHorizonOrders,
  sourcingPlans,
  logisticsPlans,
  policy: mvHorizonPolicy,
  approver: syntheticApprover,
  timestamps: timeline,
  ids: MV_HORIZON_IDS,
};

export const envelopeMetadata = metadata;
