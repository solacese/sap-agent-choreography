import type {
  MitigationPlan,
  PlanEvaluation,
  PolicyRuleResult,
} from "./eventSchemas";

export interface PolicyThresholds {
  readonly minimumMarginPercent: number;
  readonly maximumIncrementalCostUsd: number;
  readonly humanApprovalCostUsd: number;
  readonly minimumOrdersMeetingSla: number;
}

const rule = (
  name: PolicyRuleResult["rule"],
  passed: boolean,
  actual: string,
  threshold: string,
  explanation: string,
): PolicyRuleResult => ({ rule: name, passed, actual, threshold, explanation });

export function evaluatePlan(
  plan: MitigationPlan,
  thresholds: PolicyThresholds,
): PlanEvaluation {
  const slaPassed = plan.ordersMeetingSla >= thresholds.minimumOrdersMeetingSla;
  const marginPassed =
    plan.projectedMarginPercent >= thresholds.minimumMarginPercent;
  const costPassed =
    plan.incrementalCostUsd <= thresholds.maximumIncrementalCostUsd;
  const requiresHumanApproval =
    plan.incrementalCostUsd >= thresholds.humanApprovalCostUsd;

  const rules: PolicyRuleResult[] = [
    rule(
      "sla-preservation",
      slaPassed,
      `${plan.ordersMeetingSla}/${plan.totalOrders} orders`,
      `at least ${thresholds.minimumOrdersMeetingSla}/${plan.totalOrders} orders`,
      slaPassed
        ? "The option protects the required number of customer promises."
        : "Too many customer promises remain exposed.",
    ),
    rule(
      "margin-floor",
      marginPassed,
      `${plan.projectedMarginPercent.toFixed(1)}% margin`,
      `at least ${thresholds.minimumMarginPercent.toFixed(1)}% margin`,
      marginPassed
        ? "Projected margin remains above the policy floor."
        : "Projected margin falls below the policy floor.",
    ),
    rule(
      "cost-to-serve-cap",
      costPassed,
      `$${plan.incrementalCostUsd.toLocaleString("en-US")}`,
      `at most $${thresholds.maximumIncrementalCostUsd.toLocaleString("en-US")}`,
      costPassed
        ? "Incremental cost is within the disruption budget."
        : "Incremental cost exceeds the disruption budget.",
    ),
    rule(
      "human-approval-threshold",
      !requiresHumanApproval,
      `$${plan.incrementalCostUsd.toLocaleString("en-US")}`,
      `below $${thresholds.humanApprovalCostUsd.toLocaleString("en-US")} for auto-clear`,
      requiresHumanApproval
        ? "The spend threshold requires a durable human approval before execution."
        : "This option is eligible for automatic approval on spend.",
    ),
  ];

  const eligible = slaPassed && marginPassed && costPassed;
  const slaCoverage = plan.ordersMeetingSla / plan.totalOrders;
  const costEfficiency =
    1 -
    Math.min(plan.incrementalCostUsd, thresholds.maximumIncrementalCostUsd) /
      thresholds.maximumIncrementalCostUsd;
  const marginHeadroom = Math.max(
    0,
    plan.projectedMarginPercent - thresholds.minimumMarginPercent,
  );
  const score = Math.round(
    (slaCoverage * 60 + costEfficiency * 25 + marginHeadroom * 3) * 10,
  ) / 10;

  return {
    planId: plan.planId,
    eligible,
    requiresHumanApproval,
    score,
    rules,
    explanation: eligible
      ? `${plan.title} is policy-eligible with ${plan.ordersMeetingSla}/${plan.totalOrders} SLAs protected and a projected ${plan.projectedMarginPercent.toFixed(1)}% margin.${requiresHumanApproval ? " Human approval is required because of incremental spend." : " Spend is below the auto-clear threshold."}`
      : `${plan.title} is not eligible because ${rules
          .filter(
            (result) =>
              !result.passed && result.rule !== "human-approval-threshold",
          )
          .map((result) => result.rule)
          .join(" and ")} failed.`,
  };
}

export function recommendPlan(
  plans: readonly MitigationPlan[],
  thresholds: PolicyThresholds,
): { readonly recommendedPlanId: string; readonly evaluations: PlanEvaluation[] } {
  if (plans.length === 0) {
    throw new Error("At least one mitigation plan is required");
  }

  const evaluations = plans.map((plan) => evaluatePlan(plan, thresholds));
  const eligible = evaluations.filter((evaluation) => evaluation.eligible);

  if (eligible.length === 0) {
    throw new Error("No mitigation plan satisfies mandatory policy rules");
  }

  const recommended = [...eligible].sort(
    (left, right) =>
      right.score - left.score || left.planId.localeCompare(right.planId),
  )[0];

  if (!recommended) {
    throw new Error("No recommendation could be selected");
  }

  return { recommendedPlanId: recommended.planId, evaluations };
}
