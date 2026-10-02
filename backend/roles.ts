import type { AgentName, CloudSession, WorkerAgentName } from "./shared";

export const workerAgents: WorkerAgentName[] = ["sourcing", "logistics", "customer-sla"];
export const allRoles: AgentName[] = [...workerAgents, "supervisor"];

export const roleOptions: Record<WorkerAgentName, Array<{ id: string; label: string; result: Record<string, unknown> }>> = {
  sourcing: [
    { id: "regional-stock", label: "Reallocate regional safety stock", result: { proposalId: "HUMAN-SOURCE-01", title: "Reallocate regional safety stock", incrementalCostUsd: 12000, ordersMeetingSla: 2, rationale: "Use Benelux inventory for priority customers." } },
    { id: "air-critical", label: "Airfreight critical units", result: { proposalId: "HUMAN-SOURCE-02", title: "Airfreight critical units", incrementalCostUsd: 58000, ordersMeetingSla: 3, rationale: "Protect every SLA at higher margin cost." } },
    { id: "hold", label: "Hold and expedite clearance", result: { proposalId: "HUMAN-SOURCE-03", title: "Hold and expedite clearance", incrementalCostUsd: 8400, ordersMeetingSla: 1, rationale: "Minimize spend while accepting service exposure." } },
  ],
  logistics: [
    { id: "zeebrugge", label: "Divert via Zeebrugge", result: { proposalId: "HUMAN-LOGISTICS-01", title: "Divert via Zeebrugge express connection", incrementalCostUsd: 38000, ordersMeetingSla: 3, rationale: "Priority feeder and dedicated final mile protect all promises." } },
    { id: "priority-feeder", label: "Book a priority feeder", result: { proposalId: "HUMAN-LOGISTICS-02", title: "Priority Rotterdam feeder", incrementalCostUsd: 27000, ordersMeetingSla: 2, rationale: "Moderate cost with residual delay for one order." } },
    { id: "current-route", label: "Keep the current route", result: { proposalId: "HUMAN-LOGISTICS-03", title: "Keep current route", incrementalCostUsd: 0, ordersMeetingSla: 0, rationale: "Avoid incremental transport spend." } },
  ],
  "customer-sla": [
    { id: "protect-platinum", label: "Prioritize Platinum customer", result: { assessmentId: "HUMAN-SLA-01", priority: "platinum-first", exposureUsd: 67500, recommendation: "Protect Helios Medical first and notify all customers now." } },
    { id: "protect-all", label: "Protect all promised dates", result: { assessmentId: "HUMAN-SLA-02", priority: "all-slas", exposureUsd: 67500, recommendation: "Choose the plan that protects 3/3 SLAs." } },
    { id: "cost-first", label: "Minimize cost exposure", result: { assessmentId: "HUMAN-SLA-03", priority: "cost-first", exposureUsd: 67500, recommendation: "Accept lower-tier delays to preserve margin." } },
  ],
};

export const rolesReady = (session: CloudSession) => workerAgents.every((agent) => session.agentStatus[agent] === "complete");
