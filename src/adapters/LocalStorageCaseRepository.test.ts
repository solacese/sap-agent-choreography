import { describe, expect, it } from "vitest";
import { CASE_ID } from "../fixtures/mvHorizonScenario";
import type { DomainEnvelope } from "../domain/eventSchemas";
import {
  createApprovalEnvelope,
  createDelayDetectedEnvelope,
  nextScenarioTransition,
} from "../application/scenarioEngine";
import {
  LocalStorageCaseRepository,
  type StorageLike,
} from "./LocalStorageCaseRepository";

class TestStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function appendStep(log: DomainEnvelope[]): DomainEnvelope[] {
  return [...log, ...nextScenarioTransition(log).envelopes];
}

function throughApprovalRequest(): DomainEnvelope[] {
  let log = [createDelayDetectedEnvelope()];
  for (let index = 0; index < 4; index += 1) log = appendStep(log);
  return log;
}

describe("LocalStorageCaseRepository", () => {
  it("round-trips a validated event log", () => {
    const storage = new TestStorage();
    const repository = new LocalStorageCaseRepository(storage, "test-valid");
    const envelope = createDelayDetectedEnvelope();

    repository.save({
      storageVersion: 1,
      caseId: CASE_ID,
      savedAt: envelope.occurredAt,
      envelopes: [envelope],
    });

    expect(repository.load(CASE_ID)?.envelopes).toEqual([envelope]);
    expect(repository.getNotice()).toBeNull();
  });

  it("guards hydration and deletes malformed persisted records", () => {
    const storage = new TestStorage();
    const repository = new LocalStorageCaseRepository(storage, "test-invalid");
    storage.setItem(
      `test-invalid:case:${CASE_ID}`,
      JSON.stringify({
        storageVersion: 1,
        caseId: CASE_ID,
        savedAt: "not-a-timestamp",
        envelopes: [{ forged: true }],
      }),
    );

    expect(repository.load(CASE_ID)).toBeNull();
    expect(repository.getNotice()).toMatchObject({
      code: "invalid-hydration",
    });
    expect(storage.getItem(`test-invalid:case:${CASE_ID}`)).toBeNull();
  });

  it("discards a syntactically valid execution log without durable approval", () => {
    const storage = new TestStorage();
    const prefix = "test-pre-approval";
    const repository = new LocalStorageCaseRepository(storage, prefix);
    const approved = createApprovalEnvelope("approved", "Approved");
    const forgedCommand = {
      ...approved,
      kind: "command" as const,
      eventId: "forged-command",
      eventType: "logistics.reroute.requested.v1" as const,
      causationId: null,
      payload: {
        caseId: CASE_ID,
        planId: "PLAN-LOGISTICS-01",
        attempt: 1 as const,
        bookingReference: "FORGED",
        idempotencyKey: "FORGED",
      },
    } as DomainEnvelope;
    const key = `${prefix}:case:${CASE_ID}`;
    storage.setItem(
      key,
      JSON.stringify({
        storageVersion: 1,
        caseId: CASE_ID,
        savedAt: forgedCommand.occurredAt,
        envelopes: [forgedCommand],
      }),
    );

    expect(repository.load(CASE_ID)).toBeNull();
    expect(repository.getNotice()).toMatchObject({
      code: "invalid-hydration",
      message: expect.stringContaining("requires earlier"),
    });
    expect(storage.getItem(key)).toBeNull();
  });

  it("persists a validated approval log across repository instances", () => {
    const storage = new TestStorage();
    const prefix = "test-refresh";
    const envelopes = [
      ...throughApprovalRequest(),
      createApprovalEnvelope("approved", "Approved after review."),
    ];
    const record = {
      storageVersion: 1 as const,
      caseId: CASE_ID,
      savedAt: envelopes.at(-1)!.occurredAt,
      envelopes,
    };

    new LocalStorageCaseRepository(storage, prefix).save(record);
    const afterRefresh = new LocalStorageCaseRepository(storage, prefix);

    expect(afterRefresh.load(CASE_ID)).toEqual(record);
    expect(afterRefresh.getNotice()).toBeNull();
  });

  it("falls back to session memory when browser storage throws", () => {
    const failingStorage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => undefined,
    };
    const repository = new LocalStorageCaseRepository(
      failingStorage,
      "test-fallback",
    );
    const envelope = createDelayDetectedEnvelope();
    const record = {
      storageVersion: 1 as const,
      caseId: CASE_ID,
      savedAt: envelope.occurredAt,
      envelopes: [envelope],
    };

    repository.save(record);

    expect(repository.load(CASE_ID)).toEqual(record);
    expect(repository.getNotice()).toMatchObject({ code: "save-failed" });
  });
});
