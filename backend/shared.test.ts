import { describe, expect, it } from "vitest";
import { migrateSession } from "./shared";

describe("legacy cloud session migration", () => {
  it("adds multiplayer fields to sessions created before role claims existed", () => {
    const migrated = migrateSession({
      sessionId: "legacy", joinCode: "ABC123", createdAt: "2026-10-01T00:00:00Z",
      expiresAt: 1, revision: 0, events: [], status: "active", votes: {},
      agentStatus: { sourcing: "complete", logistics: "waiting", "customer-sla": "waiting" } as never,
    });
    expect(migrated.mode).toBe("human-agents");
    expect(migrated.roleClaims).toEqual({});
    expect(migrated.agentResults).toEqual({});
    expect(migrated.agentStatus).toEqual({ sourcing: "complete", logistics: "waiting", "customer-sla": "waiting", supervisor: "waiting" });
  });
});
