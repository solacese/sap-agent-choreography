import { addEvent, createEvent, loadSession, publishSolace, replaceSession } from "./shared";

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function commit(sessionId: string, expectedStatus: string, status: "executing" | "execution-failed" | "completed", events: ReturnType<typeof createEvent>[]) {
  const session = await loadSession(sessionId);
  if (!session || session.status !== expectedStatus) return null;
  const next = events.reduce(addEvent, session);
  const updated = { ...next, status };
  try {
    await replaceSession(updated, session.revision);
    await Promise.all(events.map(publishSolace));
    return updated;
  } catch (error) {
    if ((error as { name?: string }).name === "ConditionalCheckFailedException") return null;
    throw error;
  }
}

export async function handler(input: { sessionId: string; action: "start" | "retry" }) {
  const session = await loadSession(input.sessionId);
  if (!session) return;

  if (input.action === "start") {
    if (session.status !== "approved") return;
    const command = createEvent(session.sessionId, "logistics.reroute.requested.v1", "execution-orchestrator", { planId: "PLAN-LOGISTICS-01", attempt: 1 }, session.events.at(-1)?.eventId ?? null);
    const started = await commit(session.sessionId, "approved", "executing", [command]);
    if (!started) return;
    await sleep(1200);
    const failure = createEvent(session.sessionId, "logistics.reroute.failed.v1", "logistics-execution-service", { attempt: 1, errorCode: "CARRIER_QUOTE_EXPIRED", retryable: true, message: "Carrier quote expired during approval; refresh and retry." }, command.eventId);
    await commit(session.sessionId, "executing", "execution-failed", [failure]);
    return;
  }

  if (session.status !== "execution-failed") return;
  const retry = createEvent(session.sessionId, "logistics.reroute.requested.v1", "execution-orchestrator", { planId: "PLAN-LOGISTICS-01", attempt: 2 }, session.events.at(-1)?.eventId ?? null);
  const retrying = await commit(session.sessionId, "execution-failed", "executing", [retry]);
  if (!retrying) return;
  await sleep(900);
  const completed = createEvent(session.sessionId, "logistics.reroute.completed.v1", "logistics-execution-service", { attempt: 2, bookingReference: "RRT-HZN-042", carrier: "NorthSea Feeder", route: "Singapore → Zeebrugge → Rotterdam" }, retry.eventId);
  const orders = createEvent(session.sessionId, "order.status.updated.v1", "sap-integration-suite", { orderIds: ["SO-471100", "SO-471128", "SO-471141"], status: "REROUTED" }, completed.eventId);
  const notified = createEvent(session.sessionId, "customer.notification.sent.v1", "customer-channel-service", { customers: 3, channels: ["email", "portal"] }, orders.eventId);
  await commit(session.sessionId, "executing", "completed", [completed, orders, notified]);
}
