import { describe, expect, it } from "vitest";
import { evaluatePlan, recommendPlan } from "./policy";
import {
  allMitigationPlans,
  logisticsPlans,
  mvHorizonPolicy,
  sourcingPlans,
} from "../fixtures/mvHorizonScenario";

describe("policy evaluation", () => {
  it("recommends the only plan that protects every SLA within margin and cost policy", () => {
    const result = recommendPlan(allMitigationPlans, mvHorizonPolicy);

    expect(result.recommendedPlanId).toBe("PLAN-LOGISTICS-01");
    expect(result.evaluations).toHaveLength(3);
    expect(
      result.evaluations.find(
        (evaluation) => evaluation.planId === "PLAN-LOGISTICS-01",
      ),
    ).toMatchObject({
      eligible: true,
      requiresHumanApproval: true,
    });
  });

  it("explains each failed mandatory rule and keeps approval separate from eligibility", () => {
    const inventory = evaluatePlan(sourcingPlans[0]!, mvHorizonPolicy);
    const airfreight = evaluatePlan(sourcingPlans[1]!, mvHorizonPolicy);
    const diversion = evaluatePlan(logisticsPlans[0]!, mvHorizonPolicy);

    expect(inventory.eligible).toBe(false);
    expect(
      inventory.rules.find((rule) => rule.rule === "sla-preservation"),
    ).toMatchObject({ passed: false });

    expect(airfreight.eligible).toBe(false);
    expect(
      airfreight.rules.filter(
        (rule) =>
          !rule.passed && rule.rule !== "human-approval-threshold",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "margin-floor" }),
        expect.objectContaining({ rule: "cost-to-serve-cap" }),
      ]),
    );

    expect(diversion.eligible).toBe(true);
    expect(diversion.requiresHumanApproval).toBe(true);
    expect(diversion.rules).toHaveLength(4);
  });
});
