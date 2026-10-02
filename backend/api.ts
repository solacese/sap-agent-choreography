import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  addEvent, claimMonthlySession, createEvent, createJoinCode, createSessionRecord, createToken, findByJoinCode,
  invokeWorker, loadSession, newId, publishSolace, replaceSession, response, siteUrl, verifyToken,
  type CloudSession,
} from "./shared";

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
    agentStatus: { sourcing: "waiting", logistics: "waiting", "customer-sla": "waiting" },
    agentResults: {}, votes: { sla: 0, cost: 0, margin: 0, emissions: 0 },
  };
  await createSessionRecord(session);
  return response(201, {
    session, presenterToken: createToken(sessionId, "presenter"), approverToken: createToken(sessionId, "approver"),
    joinUrl: `${siteUrl}?session=${sessionId}&code=${session.joinCode}`,
    approverUrl: `${siteUrl}?session=${sessionId}#token=${encodeURIComponent(createToken(sessionId, "approver"))}&role=approver`,
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

  if (method === "POST" && action === "vote") {
    const objective = String(body.objective ?? "");
    if (!(objective in session.votes)) return response(400, { error: "Unknown objective" });
    const next = { ...session, revision: session.revision + 1, votes: { ...session.votes, [objective]: session.votes[objective]! + 1 } };
    await replaceSession(next, session.revision);
    return response(200, { session: next });
  }

  if (method === "POST" && action === "trigger") {
    if (role !== "presenter") return response(403, { error: "Presenter role required" });
    if (session.events.length) return response(409, { error: "Already triggered" });
    const delay = createEvent(sessionId, "shipment.delay.detected.v1", "sap-s4-enterprise-event-enablement", { vessel: "MV Horizon", delayHours: 36, source: "SAP S/4HANA" });
    const risk = createEvent(sessionId, "order.risk.assessed.v1", "integration-suite-orchestrator", { ordersAtRisk: 3, slaExposureUsd: 67500, guardrailPassed: true }, delay.eventId);
    const assessed = addEvent(addEvent(session, delay), risk);
    await replaceSession(assessed, session.revision);
    const publishedToSolace = await Promise.all(assessed.events.map(publishSolace));
    if (!publishedToSolace.some(Boolean)) {
      await Promise.all([
        invokeWorker(process.env.SOURCING_FUNCTION!, { sessionId, agent: "sourcing" }),
        invokeWorker(process.env.LOGISTICS_FUNCTION!, { sessionId, agent: "logistics" }),
        invokeWorker(process.env.CUSTOMER_SLA_FUNCTION!, { sessionId, agent: "customer-sla" }),
      ]);
    }
    return response(202, { session: assessed, transport: publishedToSolace.some(Boolean) ? "solace" : "aws-direct-fallback" });
  }

  if (method === "POST" && ["approve", "reject"].includes(action ?? "")) {
    if (role !== "approver" && role !== "presenter") return response(403, { error: "Approver role required" });
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
