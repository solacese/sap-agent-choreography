import { z } from "zod";

export const SCHEMA_VERSION = "1.0" as const;

const IdentifierSchema = z.string().min(1);
const TimestampSchema = z.string().datetime({ offset: true });

export const CustomerTierSchema = z.enum(["PLATINUM", "GOLD", "SILVER"]);
export type CustomerTier = z.infer<typeof CustomerTierSchema>;

export const OrderRiskSchema = z
  .object({
    orderId: IdentifierSchema,
    customerName: z.string().min(1),
    customerTier: CustomerTierSchema,
    destination: z.string().min(1),
    orderValueUsd: z.number().nonnegative(),
    promisedDeliveryAt: TimestampSchema,
    projectedDeliveryAt: TimestampSchema,
    projectedDelayHours: z.number().positive(),
    slaExposureUsd: z.number().nonnegative(),
  })
  .strict();
export type OrderRisk = z.infer<typeof OrderRiskSchema>;

export const ProposalSourceSchema = z.enum(["sourcing", "logistics"]);
export type ProposalSource = z.infer<typeof ProposalSourceSchema>;

export const MitigationPlanSchema = z
  .object({
    planId: IdentifierSchema,
    source: ProposalSourceSchema,
    title: z.string().min(1),
    summary: z.string().min(1),
    etaRecoveryHours: z.number().nonnegative(),
    incrementalCostUsd: z.number().nonnegative(),
    projectedMarginPercent: z.number(),
    ordersMeetingSla: z.number().int().nonnegative(),
    totalOrders: z.number().int().positive(),
    executionMode: z.enum([
      "inventory-reallocation",
      "airfreight",
      "port-diversion",
    ]),
  })
  .strict()
  .refine((plan) => plan.ordersMeetingSla <= plan.totalOrders, {
    message: "ordersMeetingSla cannot exceed totalOrders",
    path: ["ordersMeetingSla"],
  });
export type MitigationPlan = z.infer<typeof MitigationPlanSchema>;

export const PolicyRuleResultSchema = z
  .object({
    rule: z.enum([
      "sla-preservation",
      "margin-floor",
      "cost-to-serve-cap",
      "human-approval-threshold",
    ]),
    passed: z.boolean(),
    actual: z.string().min(1),
    threshold: z.string().min(1),
    explanation: z.string().min(1),
  })
  .strict();
export type PolicyRuleResult = z.infer<typeof PolicyRuleResultSchema>;

export const PlanEvaluationSchema = z
  .object({
    planId: IdentifierSchema,
    eligible: z.boolean(),
    requiresHumanApproval: z.boolean(),
    score: z.number(),
    rules: z.array(PolicyRuleResultSchema).length(4),
    explanation: z.string().min(1),
  })
  .strict();
export type PlanEvaluation = z.infer<typeof PlanEvaluationSchema>;

const EnvelopeMetadata = {
  eventId: IdentifierSchema,
  schemaVersion: z.literal(SCHEMA_VERSION),
  occurredAt: TimestampSchema,
  correlationId: IdentifierSchema,
  causationId: IdentifierSchema.nullable(),
  relatedEventIds: z.array(IdentifierSchema),
  producer: IdentifierSchema,
  consumers: z.array(IdentifierSchema).min(1),
  topic: IdentifierSchema,
};

const eventEnvelope = <T extends string, S extends z.ZodTypeAny>(
  eventType: T,
  payload: S,
) =>
  z
    .object({
      ...EnvelopeMetadata,
      kind: z.literal("event"),
      eventType: z.literal(eventType),
      payload,
    })
    .strict();

const commandEnvelope = <T extends string, S extends z.ZodTypeAny>(
  eventType: T,
  payload: S,
) =>
  z
    .object({
      ...EnvelopeMetadata,
      kind: z.literal("command"),
      eventType: z.literal(eventType),
      payload,
    })
    .strict();

export const ShipmentDelayDetectedEnvelopeSchema = eventEnvelope(
  "shipment.delay.detected.v1",
  z
    .object({
      caseId: IdentifierSchema,
      vesselId: IdentifierSchema,
      vesselName: z.string().min(1),
      voyageNumber: IdentifierSchema,
      originPort: z.string().min(1),
      destinationPort: z.string().min(1),
      delayHours: z.number().positive(),
      detectedBy: z.string().min(1),
      reason: z.string().min(1),
    })
    .strict(),
);

export const OrderRiskAssessedEnvelopeSchema = eventEnvelope(
  "order.risk.assessed.v1",
  z
    .object({
      caseId: IdentifierSchema,
      orders: z.array(OrderRiskSchema).min(1),
      totalSlaExposureUsd: z.number().nonnegative(),
      reasoningSummary: z.string().min(1),
    })
    .strict(),
);

export const SourcingOptionsProposedEnvelopeSchema = eventEnvelope(
  "sourcing.options.proposed.v1",
  z
    .object({
      caseId: IdentifierSchema,
      plans: z.array(MitigationPlanSchema).min(1),
      reasoningSummary: z.string().min(1),
      consideredSystems: z.array(z.string().min(1)).min(1),
    })
    .strict(),
);

export const LogisticsOptionsProposedEnvelopeSchema = eventEnvelope(
  "logistics.options.proposed.v1",
  z
    .object({
      caseId: IdentifierSchema,
      plans: z.array(MitigationPlanSchema).min(1),
      reasoningSummary: z.string().min(1),
      consideredSystems: z.array(z.string().min(1)).min(1),
    })
    .strict(),
);

export const RemediationPlanRecommendedEnvelopeSchema = eventEnvelope(
  "remediation.plan.recommended.v1",
  z
    .object({
      caseId: IdentifierSchema,
      recommendedPlanId: IdentifierSchema,
      evaluations: z.array(PlanEvaluationSchema).min(1),
      reasoningSummary: z.string().min(1),
    })
    .strict(),
);

export const RemediationPlanApprovalRequestedEnvelopeSchema = eventEnvelope(
  "remediation.plan.approval_requested.v1",
  z
    .object({
      caseId: IdentifierSchema,
      planId: IdentifierSchema,
      requestedAt: TimestampSchema,
      approvalReason: z.string().min(1),
      expiresAt: TimestampSchema,
    })
    .strict(),
);

const ApprovalActorSchema = z
  .object({
    actorId: IdentifierSchema,
    displayName: z.string().min(1),
    channel: z.enum(["Joule", "mobile", "workflow"]),
  })
  .strict();
export type ApprovalActor = z.infer<typeof ApprovalActorSchema>;

export const RemediationPlanApprovedEnvelopeSchema = eventEnvelope(
  "remediation.plan.approved.v1",
  z
    .object({
      caseId: IdentifierSchema,
      planId: IdentifierSchema,
      actor: ApprovalActorSchema,
      decisionAt: TimestampSchema,
      comment: z.string().min(1),
    })
    .strict(),
);

export const RemediationPlanRejectedEnvelopeSchema = eventEnvelope(
  "remediation.plan.rejected.v1",
  z
    .object({
      caseId: IdentifierSchema,
      planId: IdentifierSchema,
      actor: ApprovalActorSchema,
      decisionAt: TimestampSchema,
      reason: z.string().min(1),
    })
    .strict(),
);

export const LogisticsRerouteRequestedEnvelopeSchema = commandEnvelope(
  "logistics.reroute.requested.v1",
  z
    .object({
      caseId: IdentifierSchema,
      planId: IdentifierSchema,
      attempt: z.number().int().min(1).max(2),
      bookingReference: IdentifierSchema,
      idempotencyKey: IdentifierSchema,
    })
    .strict(),
);

export const LogisticsRerouteFailedEnvelopeSchema = eventEnvelope(
  "logistics.reroute.failed.v1",
  z
    .object({
      caseId: IdentifierSchema,
      planId: IdentifierSchema,
      attempt: z.literal(1),
      errorCode: z.literal("CARRIER_QUOTE_EXPIRED"),
      retryable: z.literal(true),
      message: z.string().min(1),
    })
    .strict(),
);

export const LogisticsRerouteCompletedEnvelopeSchema = eventEnvelope(
  "logistics.reroute.completed.v1",
  z
    .object({
      caseId: IdentifierSchema,
      planId: IdentifierSchema,
      attempt: z.literal(2),
      bookingReference: IdentifierSchema,
      carrier: z.string().min(1),
      newRoute: z.string().min(1),
      expectedArrivalAt: TimestampSchema,
    })
    .strict(),
);

export const OrderStatusUpdatedEnvelopeSchema = eventEnvelope(
  "order.status.updated.v1",
  z
    .object({
      caseId: IdentifierSchema,
      orderIds: z.array(IdentifierSchema).min(1),
      status: z.literal("REROUTED"),
      promisedDatesProtected: z.literal(true),
    })
    .strict(),
);

export const CustomerNotificationSentEnvelopeSchema = eventEnvelope(
  "customer.notification.sent.v1",
  z
    .object({
      caseId: IdentifierSchema,
      orderIds: z.array(IdentifierSchema).min(1),
      channels: z.array(z.enum(["email", "portal", "sms"])).min(1),
      templateId: IdentifierSchema,
      messageSummary: z.string().min(1),
    })
    .strict(),
);

export const EventEnvelopeSchema = z.discriminatedUnion("eventType", [
  ShipmentDelayDetectedEnvelopeSchema,
  OrderRiskAssessedEnvelopeSchema,
  SourcingOptionsProposedEnvelopeSchema,
  LogisticsOptionsProposedEnvelopeSchema,
  RemediationPlanRecommendedEnvelopeSchema,
  RemediationPlanApprovalRequestedEnvelopeSchema,
  RemediationPlanApprovedEnvelopeSchema,
  RemediationPlanRejectedEnvelopeSchema,
  LogisticsRerouteFailedEnvelopeSchema,
  LogisticsRerouteCompletedEnvelopeSchema,
  OrderStatusUpdatedEnvelopeSchema,
  CustomerNotificationSentEnvelopeSchema,
]);

export const CommandEnvelopeSchema = z.discriminatedUnion("eventType", [
  LogisticsRerouteRequestedEnvelopeSchema,
]);

export const DomainEnvelopeSchema = z.union([
  EventEnvelopeSchema,
  CommandEnvelopeSchema,
]);
export const DomainEnvelopeArraySchema = z.array(DomainEnvelopeSchema);

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
export type DomainEnvelope = z.infer<typeof DomainEnvelopeSchema>;
export type EventType = DomainEnvelope["eventType"];

export function parseDomainEnvelope(input: unknown): DomainEnvelope {
  return DomainEnvelopeSchema.parse(input);
}

export function parseDomainEnvelopeLog(input: unknown): DomainEnvelope[] {
  return DomainEnvelopeArraySchema.parse(input);
}
