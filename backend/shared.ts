import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

export const tableName = process.env.TABLE_NAME!;
export const siteUrl = process.env.SITE_URL ?? "https://solacese.github.io/sap-agent-choreography/";
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
export const lambda = new LambdaClient({});
const secrets = new SecretsManagerClient({});

export type AgentName = "sourcing" | "logistics" | "customer-sla";
export type AgentState = "waiting" | "running" | "complete" | "failed";

export interface CloudEvent {
  eventId: string;
  eventType: string;
  producer: string;
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  payload: Record<string, unknown>;
}

export interface CloudSession {
  sessionId: string;
  joinCode: string;
  status: "active" | "approval-required" | "approved" | "rejected" | "completed";
  createdAt: string;
  expiresAt: number;
  revision: number;
  events: CloudEvent[];
  agentStatus: Record<AgentName, AgentState>;
  agentResults: Partial<Record<AgentName, Record<string, unknown>>>;
  votes: Record<string, number>;
}

export const response = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,x-session-token",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "cache-control": "no-store",
  },
  body: statusCode === 204 ? "" : JSON.stringify(body),
});

export const sessionKey = (sessionId: string) => ({ pk: `SESSION#${sessionId}`, sk: "META" });

export async function loadSession(sessionId: string): Promise<CloudSession | null> {
  const result = await ddb.send(new GetCommand({ TableName: tableName, Key: sessionKey(sessionId), ConsistentRead: true }));
  return (result.Item?.session as CloudSession | undefined) ?? null;
}

export async function createSessionRecord(session: CloudSession): Promise<void> {
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: tableName, Item: { ...sessionKey(session.sessionId), ttl: session.expiresAt, session }, ConditionExpression: "attribute_not_exists(pk)" } },
    { Put: { TableName: tableName, Item: { pk: `JOIN#${session.joinCode}`, sk: "LOOKUP", sessionId: session.sessionId, ttl: session.expiresAt }, ConditionExpression: "attribute_not_exists(pk)" } },
  ] }));
}

export async function replaceSession(session: CloudSession, expectedRevision: number): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: tableName,
    Key: sessionKey(session.sessionId),
    UpdateExpression: "SET #session = :session, #ttl = :ttl",
    ConditionExpression: "#session.#revision = :revision",
    ExpressionAttributeNames: { "#session": "session", "#revision": "revision", "#ttl": "ttl" },
    ExpressionAttributeValues: { ":session": session, ":ttl": session.expiresAt, ":revision": expectedRevision },
  }));
}

export async function appendAgentUpdate(
  sessionId: string,
  agent: AgentName,
  state: AgentState,
  event: CloudEvent,
  result?: Record<string, unknown>,
): Promise<void> {
  const names: Record<string, string> = {
    "#session": "session", "#events": "events", "#revision": "revision", "#agentStatus": "agentStatus", "#agent": agent,
  };
  const values: Record<string, unknown> = { ":events": [event], ":one": 1, ":state": state };
  let expression = "SET #session.#events = list_append(#session.#events, :events), #session.#revision = #session.#revision + :one, #session.#agentStatus.#agent = :state";
  if (result) {
    names["#agentResults"] = "agentResults";
    values[":result"] = result;
    expression += ", #session.#agentResults.#agent = :result";
  }
  await ddb.send(new UpdateCommand({
    TableName: tableName, Key: sessionKey(sessionId), UpdateExpression: expression,
    ConditionExpression: "attribute_exists(pk)", ExpressionAttributeNames: names, ExpressionAttributeValues: values,
  }));
}

export async function findByJoinCode(code: string): Promise<CloudSession | null> {
  const result = await ddb.send(new GetCommand({
    TableName: tableName, Key: { pk: `JOIN#${code.toUpperCase()}`, sk: "LOOKUP" }, ConsistentRead: true,
  }));
  const sessionId = result.Item?.sessionId as string | undefined;
  return sessionId ? loadSession(sessionId) : null;
}

export function createToken(sessionId: string, role: "presenter" | "approver" | "participant"): string {
  const expiry = Math.floor(Date.now() / 1000) + 4 * 60 * 60;
  const value = `${sessionId}.${role}.${expiry}`;
  const signature = createHmac("sha256", process.env.TOKEN_SECRET!).update(value).digest("base64url");
  return `${value}.${signature}`;
}

export function verifyToken(token: string | undefined, sessionId: string) {
  if (!token) return null;
  const [tokenSession, role, expiryText, signature] = token.split(".");
  if (!tokenSession || !role || !expiryText || !signature || tokenSession !== sessionId || Number(expiryText) < Date.now() / 1000) return null;
  const value = `${tokenSession}.${role}.${expiryText}`;
  const expected = createHmac("sha256", process.env.TOKEN_SECRET!).update(value).digest("base64url");
  const valid = signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  return valid && ["presenter", "approver", "participant"].includes(role) ? role as "presenter" | "approver" | "participant" : null;
}

export const newId = (prefix: string) => `${prefix}-${randomBytes(8).toString("hex")}`;
export const createJoinCode = () => randomBytes(3).toString("hex").toUpperCase();

export function createEvent(sessionId: string, type: string, producer: string, payload: Record<string, unknown>, causationId: string | null = null): CloudEvent {
  return { eventId: newId("evt"), eventType: type, producer, occurredAt: new Date().toISOString(), correlationId: `cloud-${sessionId}`, causationId, payload };
}

export function addEvent(session: CloudSession, event: CloudEvent): CloudSession {
  return { ...session, revision: session.revision + 1, events: [...session.events, event] };
}

export async function invokeWorker(functionName: string, payload: unknown): Promise<void> {
  await lambda.send(new InvokeCommand({ FunctionName: functionName, InvocationType: "Event", Payload: Buffer.from(JSON.stringify(payload)) }));
}

let solaceConfig: { restUrl: string; username: string; password: string } | null | undefined;
async function getSolaceConfig() {
  if (solaceConfig !== undefined) return solaceConfig;
  if (!process.env.SOLACE_SECRET_ARN) return solaceConfig = null;
  const value = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.SOLACE_SECRET_ARN }));
  const parsed = JSON.parse(value.SecretString ?? "{}") as Record<string, string>;
  return solaceConfig = parsed.restUrl && parsed.username && parsed.password
    ? { restUrl: parsed.restUrl, username: parsed.username, password: parsed.password }
    : null;
}

export async function publishSolace(event: CloudEvent): Promise<boolean> {
  const config = await getSolaceConfig();
  if (!config) return false;
  const auth = Buffer.from(`${config.username}:${config.password}`).toString("base64");
  const topic = `demo/sap/supply-chain/v1/${event.correlationId}/${event.eventType.replaceAll(".", "/")}`;
  const result = await fetch(`${config.restUrl.replace(/\/$/, "")}/${topic}`, {
    method: "POST", headers: { authorization: `Basic ${auth}`, "content-type": "application/json", "solace-delivery-mode": "persistent" }, body: JSON.stringify(event),
  });
  if (!result.ok) throw new Error(`Solace publish failed: ${result.status}`);
  return true;
}
