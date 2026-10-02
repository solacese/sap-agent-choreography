import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  addEvent, claimMonthlySession, createEvent, createJoinCode, createSessionRecord, createToken, findByJoinCode,
  invokeWorker, loadSession, newId, publishSolace, replaceSession, response, siteUrl, verifyToken,
  type AgentName, type CloudSession, type WorkerAgentName,
} from "./shared";
import { allRoles, roleOptions, rolesReady, workerAgents } from "./roles";

const parseBody = (event: APIGatewayProxyEventV2) => event.body ? JSON.parse(event.body) as Record<string, unknown> : {};
const token = (event: APIGatewayProxyEventV2) => event.headers["x-session-token"];

async function createSession() {
  try {
    await claimMonthlySession();
  } catch (error) {
    if ((error as { name?: string }).name === "ConditionalCheckFailedException") return response(429, { error: "Monthly demo session limit reached" });
    throw error;
  }
  const sessionId = newId("session");
  const session: CloudSession = {
    sessionId, joinCode: createJoinCode(), status: "active", createdAt: new Date().toISOString(),
    expiresAt: Math.floor(Date.now() / 1000) + 4 * 60 * 60, revision: 0, events: [],
    mode: "human-agents", agentStatus: { sourcing: "waiting", logistics: "waiting", "customer-sla": "waiting", supervisor: "waiting" },
    agentResults: {}, roleClaims: {}, votes: { sla: 0, cost: 0, margin: 0, emissions: 0 },
  };
  await createSessionRecord(session);
  return response(201, {
    session, presenterToken: createToken(sessionId, "presenter"), approverToken: createToken(sessionId, "approver"),
    joinUrl: `${siteUrl}?view=phone&session=${sessionId}&code=${session.joinCode}`,
    approverUrl: `${siteUrl}?view=phone&session=${sessionId}#token=${encodeURIComponent(createToken(sessionId, "approver"))}&role=approver`,
  });
}

export async function handler(event: APIGatewayProxyEventV2) {
  if (event.requestContext.http.method === "OPTIONS") return response(204, {});
  const path = event.rawPath;
  const method = event.requestContext.http.method;

  if (method === "POST" && path.endsWith("/sessions")) return createSession();
  if (method === "POST" && path.endsWith("/join")) {
    const body = parseBody(event);
    const session = await findByJoinCode(String(body.code ?? ""));
    if (!session || session.expiresAt < Date.now() / 1000) return response(404, { error: "Session not found or expired" });
    return response(200, { session, token: createToken(session.sessionId, "participant"), role: "participant" });
  }

  const match = path.match(/\/sessions\/([^/]+)(?:\/([^/]+))?$/);
  if (!match?.[1]) return response(404, { error: "Not found" });
  const [, sessionId, action] = match;
  const session = await loadSession(sessionId);
  if (!session) return response(404, { error: "Session not found" });
  if (method === "GET" && !action) return response(200, { session });
  const body = parseBody(event);
  const role = verifyToken(token(event), sessionId);
  if (!role) return response(401, { error: "Invalid or expired session token" });

  if (method === "POST" && action === "mode") {
    if (role.role !== "presenter" || session.events.length) return response(403, { error: "Only the presenter can select mode before start" });
    const mode: CloudSession["mode"] = body.mode === "autonomous" ? "autonomous" : "human-agents";
    const next = { ...session, mode, revision: session.revision + 1 };
    await replaceSession(next, session.revision);
    return response(200, { session: next });
  }

  if (method === "POST" && action === "claim-role") {
    if (role.role !== "participant") return response(403, { error: "Participant role required" });
    const agent = String(body.agent ?? "") as AgentName;
    if (!allRoles.includes(agent)) return response(400, { error: "Unknown role" });
    if (session.roleClaims[agent]) return response(409, { error: "Role already claimed" });
    const next = {
      ...session, revision: session.revision + 1,
      roleClaims: { ...session.roleClaims, [agent]: { subject: role.subject, displayName: String(body.displayName ?? "Participant"), claimedAt: new Date().toISOString() } },
    };
    await replaceSession(next, session.revision);
    return response(200, { session: next });
  }

  if (method === "POST" && action === "submit-decision") {
    if (role.role !== "participant") return response(403, { error: "Participant role required" });
    const agent = String(body.agent ?? "") as AgentName;
    if (session.roleClaims[agent]?.subject !== role.subject) return response(403, { error: "This participant does not own that role" });
    if (session.agentStatus[agent] === "complete") return response(409, { error: "Decision already submitted" });
    const scenarioStarted = session.events.some((item) => item.eventType === "order.risk.assessed.v1");
    if (agent !== "supervisor" && !scenarioStarted) return response(409, { error: "This agent step is not active yet" });
    if (agent === "supervisor") {
      if (!rolesReady(session)) return response(409, { error: "Supervisor must wait for all worker decisions" });
      const recommendedPlanId = String(body.optionId ?? "HUMAN-LOGISTICS-01");
      const recommendation = createEvent(sessionId, "remediation.plan.recommended.v1", "human-supervisor-agent", { recommendedPlanId, rationale: String(body.rationale ?? "Selected by participant supervisor"), workerResults: session.agentResults }, session.events.at(-1)?.eventId ?? null);
      const approval = createEvent(sessionId, "remediation.plan.approval_requested.v1", "integration-suite-orchestrator", { recommendedPlanId, source: "human supervisor" }, recommendation.eventId);
      const recommended = addEvent(addEvent(session, recommendation), approval);
      const next = { ...recommended, status: "approval-required" as const, agentStatus: { ...recommended.agentStatus, supervisor: "complete" as const }, agentResults: { ...recommended.agentResults, supervisor: { recommendedPlanId } } };
      await replaceSession(next, session.revision);
      await Promise.all([publishSolace(recommendation), publishSolace(approval)]);
      return response(200, { session: next });
    }
    const workerAgent = agent as WorkerAgentName;
    const option = roleOptions[workerAgent].find((candidate) => candidate.id === body.optionId);
    if (!option) return response(400, { error: "Unknown decision option" });
    const decision = createEvent(sessionId, `agent.${workerAgent}.completed.v1`, `human-${workerAgent}-agent`, { agent: workerAgent, optionId: option.id, result: option.result, rationale: String(body.rationale ?? "") }, session.events.find((item) => item.eventType === "order.risk.assessed.v1")?.eventId ?? null);
    const next = addEvent(session, decision);
    const updated = { ...next, agentStatus: { ...next.agentStatus, [workerAgent]: "complete" as const }, agentResults: { ...next.agentResults, [workerAgent]: option.result } };
    await replaceSession(updated, session.revision);
    await publishSolace(decision);
    if (rolesReady(updated) && !updated.roleClaims.supervisor) await invokeWorker(process.env.AGGREGATOR_FUNCTION!, { sessionId });
    return response(200, { session: updated });
  }

  if (method === "POST" && action === "vote") {
    const objective = String(body.objective ?? "");
    if (!(objective in session.votes)) return response(400, { error: "Unknown objective" });
    const next = { ...session, revision: session.revision + 1, votes: { ...session.votes, [objective]: session.votes[objective]! + 1 } };
    await replaceSession(next, session.revision);
    return response(200, { session: next });
  }

  if (method === "POST" && action === "trigger") {
    if (role.role !== "presenter") return response(403, { error: "Presenter role required" });
    if (session.events.length) return response(409, { error: "Already triggered" });
    const delay = createEvent(sessionId, "shipment.delay.detected.v1", "sap-s4-enterprise-event-enablement", { vessel: "MV Horizon", delayHours: 36, source: "SAP S/4HANA" });
    const risk = createEvent(sessionId, "order.risk.assessed.v1", "integration-suite-orchestrator", { ordersAtRisk: 3, slaExposureUsd: 67500, guardrailPassed: true }, delay.eventId);
    const assessed = addEvent(addEvent(session, delay), risk);
    await replaceSession(assessed, session.revision);
    const publishedToSolace = await Promise.all(assessed.events.map(publishSolace));
    const unclaimed = workerAgents.filter((agent) => !assessed.roleClaims[agent]);
    await Promise.all(unclaimed.map((agent) => invokeWorker(
      agent === "sourcing" ? process.env.SOURCING_FUNCTION! : agent === "logistics" ? process.env.LOGISTICS_FUNCTION! : process.env.CUSTOMER_SLA_FUNCTION!,
      { sessionId, agent },
    )));
    return response(202, { session: assessed, transport: publishedToSolace.some(Boolean) ? "solace" : "aws-direct-fallback", awaitingHumans: assessed.mode === "human-agents" && unclaimed.length < workerAgents.length });
  }

  if (method === "POST" && ["approve", "reject"].includes(action ?? "")) {
    if (role.role !== "approver" && role.role !== "presenter") return response(403, { error: "Approver role required" });
    if (session.status !== "approval-required") return response(409, { error: "Approval is not pending" });
    const approved = action === "approve";
    const decision = createEvent(sessionId, approved ? "remediation.plan.approved.v1" : "remediation.plan.rejected.v1", "mobile-approver", {
      actor: String(body.actor ?? "Mobile approver"), comment: String(body.comment ?? ""), channel: "phone",
    }, session.events.at(-1)?.eventId ?? null);
    const next = addEvent(session, decision);
    const finalized = { ...next, status: approved ? "approved" as const : "rejected" as const };
    await replaceSession(finalized, session.revision);
    await publishSolace(decision);
    return response(200, { session: finalized });
  }

  return response(404, { error: "Unknown action" });
}
