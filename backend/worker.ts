import type { AgentName } from "./shared";
import { appendAgentUpdate, createEvent, invokeWorker, loadSession, publishSolace } from "./shared";

const agent = process.env.AGENT_NAME as AgentName;
const delayByAgent: Record<AgentName, number> = { sourcing: 2200, logistics: 3000, "customer-sla": 1600 };

const results: Record<AgentName, Record<string, unknown>> = {
  sourcing: {
    proposalId: "PLAN-SOURCE-01", title: "Reallocate regional safety stock",
    incrementalCostUsd: 12000, ordersMeetingSla: 2, sourceSystems: ["SAP Ariba network", "Inventory positions"],
  },
  logistics: {
    proposalId: "PLAN-LOGISTICS-01", title: "Divert via Zeebrugge express connection",
    incrementalCostUsd: 38000, ordersMeetingSla: 3, sourceSystems: ["SAP TM", "Carrier / 3PL APIs"],
  },
  "customer-sla": {
    assessmentId: "SLA-ASSESSMENT-01", exposureUsd: 67500, platinumOrders: 1,
    recommendation: "Protect all promised dates and notify customers proactively",
  },
};

export async function handler(input: { sessionId: string; agent?: AgentName }) {
  const selectedAgent = input.agent ?? agent;
  const session = await loadSession(input.sessionId);
  if (!session || session.agentStatus[selectedAgent] !== "waiting") return;

  const causationId = session.events.find((item) => item.eventType === "order.risk.assessed.v1")?.eventId ?? null;
  const started = createEvent(session.sessionId, `agent.${selectedAgent}.started.v1`, `${selectedAgent}-agent`, {
    agent: selectedAgent, queue: `Q.DEMO.${selectedAgent.toUpperCase().replace("-", "_")}`, status: "running",
  }, causationId);
  await appendAgentUpdate(session.sessionId, selectedAgent, "running", started);
  await publishSolace(started);

  await new Promise((resolve) => setTimeout(resolve, delayByAgent[selectedAgent]));
  const completed = createEvent(session.sessionId, `agent.${selectedAgent}.completed.v1`, `${selectedAgent}-agent`, {
    agent: selectedAgent, status: "complete", result: results[selectedAgent],
  }, started.eventId);
  await appendAgentUpdate(session.sessionId, selectedAgent, "complete", completed, results[selectedAgent]);
  await publishSolace(completed);
  await invokeWorker(process.env.AGGREGATOR_FUNCTION!, { sessionId: session.sessionId });
}
