import { addEvent, createEvent, loadSession, publishSolace, replaceSession } from "./shared";

export async function handler(input: { sessionId: string }) {
  const session = await loadSession(input.sessionId);
  if (!session || session.status !== "active") return;
  if (!["sourcing", "logistics", "customer-sla"].every((agent) => session.agentStatus[agent as "sourcing" | "logistics" | "customer-sla"] === "complete")) return;
  if (session.roleClaims.supervisor) return;
  if (session.events.some((event) => event.eventType === "remediation.plan.recommended.v1")) return;

  const recommendation = createEvent(session.sessionId, "remediation.plan.recommended.v1", "supervisor-agent", {
    recommendedPlanId: "PLAN-LOGISTICS-01",
    rationale: "Protects 3/3 SLAs within the $45,000 cost ceiling and 15% margin floor.",
    agentResults: session.agentResults,
  }, session.events.at(-1)?.eventId ?? null);
  const requested = createEvent(session.sessionId, "remediation.plan.approval_requested.v1", "supervisor-agent", {
    planId: "PLAN-LOGISTICS-01", approvalReason: "Incremental spend exceeds the $25,000 auto-clear threshold",
  }, recommendation.eventId);
  const next = addEvent(addEvent(session, recommendation), requested);
  const pending = { ...next, status: "approval-required" as const, agentStatus: { ...next.agentStatus, supervisor: "complete" as const }, agentResults: { ...next.agentResults, supervisor: { recommendedPlanId: "PLAN-LOGISTICS-01", source: "autonomous fallback" } } };
  try {
    await replaceSession(pending, session.revision);
    await Promise.all([publishSolace(recommendation), publishSolace(requested)]);
  } catch (error) {
    if ((error as { name?: string }).name !== "ConditionalCheckFailedException") throw error;
  }
}
