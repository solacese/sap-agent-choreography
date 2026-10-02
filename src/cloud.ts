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
  revision: number;
  events: CloudEvent[];
  mode: "autonomous" | "human-agents";
  agentStatus: Record<"sourcing" | "logistics" | "customer-sla" | "supervisor", "waiting" | "running" | "complete" | "failed">;
  agentResults: Record<string, Record<string, unknown>>;
  roleClaims: Partial<Record<"sourcing" | "logistics" | "customer-sla" | "supervisor", { subject: string; displayName: string; claimedAt: string }>>;
  votes: Record<string, number>;
}

export interface RuntimeConfig { mode: "local" | "cloud"; apiBaseUrl: string; transport?: "solace" | "aws-direct-fallback" }
export interface CreatedCloudSession { session: CloudSession; presenterToken: string; approverToken: string; joinUrl: string; approverUrl: string }

let cachedConfig: Promise<RuntimeConfig> | undefined;
export const loadRuntimeConfig = () => cachedConfig ??= fetch(`${import.meta.env.BASE_URL}runtime-config.json`, { cache: "no-store" })
  .then(async (result): Promise<RuntimeConfig> => result.ok ? result.json() as Promise<RuntimeConfig> : { mode: "local", apiBaseUrl: "" })
  .catch((): RuntimeConfig => ({ mode: "local", apiBaseUrl: "" }));

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const config = await loadRuntimeConfig();
  if (!config.apiBaseUrl) throw new Error("Cloud collaboration is not configured");
  const result = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await result.json() as T & { error?: string };
  if (!result.ok) throw new Error(body.error ?? `Cloud request failed (${result.status})`);
  return body;
};

export const cloudApi = {
  createSession: () => request<CreatedCloudSession>("/sessions", { method: "POST" }),
  join: (code: string, role: "participant" | "approver" = "participant") => request<{ session: CloudSession; token: string; role: string }>("/join", { method: "POST", body: JSON.stringify({ code, role }) }),
  getSession: (sessionId: string) => request<{ session: CloudSession }>(`/sessions/${sessionId}`),
  action: (sessionId: string, token: string, action: string, body: Record<string, unknown> = {}) => request<{ session: CloudSession }>(`/sessions/${sessionId}/${action}`, {
    method: "POST", headers: { "x-session-token": token }, body: JSON.stringify(body),
  }),
};
