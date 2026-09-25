import { z } from "zod";
import { DomainEnvelopeArraySchema } from "../domain/eventSchemas";
import { validateScenarioLog } from "../application/scenarioEngine";
import type {
  CaseRecord,
  CaseRepository,
  RepositoryNotice,
} from "../ports/CaseRepository";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const CaseRecordSchema = z
  .object({
    storageVersion: z.literal(1),
    caseId: z.string().min(1),
    savedAt: z.string().datetime({ offset: true }),
    envelopes: DomainEnvelopeArraySchema,
  })
  .strict();

const memoryFallback = new Map<string, string>();

class MapStorage implements StorageLike {
  getItem(key: string): string | null {
    return memoryFallback.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    memoryFallback.set(key, value);
  }
  removeItem(key: string): void {
    memoryFallback.delete(key);
  }
}

function browserStorage(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

export class LocalStorageCaseRepository implements CaseRepository {
  readonly #prefix: string;
  readonly #fallback = new MapStorage();
  #primary: StorageLike | null;
  #notice: RepositoryNotice | null = null;

  constructor(storage: StorageLike | null = browserStorage(), prefix = "sap-aem-demo") {
    this.#primary = storage;
    this.#prefix = prefix;
    if (!storage) {
      this.#notice = {
        code: "storage-unavailable",
        message:
          "Browser persistence is unavailable; scenario state is retained in session memory only.",
      };
    }
  }

  #key(caseId: string): string {
    return `${this.#prefix}:case:${caseId}`;
  }

  #read(key: string): string | null {
    if (this.#primary) {
      try {
        return this.#primary.getItem(key);
      } catch {
        this.#primary = null;
        this.#notice = {
          code: "storage-unavailable",
          message:
            "Browser persistence could not be read; scenario state is using session memory.",
        };
      }
    }
    return this.#fallback.getItem(key);
  }

  load(caseId: string): CaseRecord | null {
    const key = this.#key(caseId);
    const serialized = this.#read(key);
    if (!serialized) return null;

    try {
      const parsed: unknown = JSON.parse(serialized);
      const record = CaseRecordSchema.parse(parsed);
      if (record.caseId !== caseId) {
        throw new Error("Persisted case ID does not match the requested case");
      }
      const validation = validateScenarioLog(record.envelopes);
      if (!validation.success) {
        throw new Error(validation.reason ?? "Persisted log failed validation");
      }
      return record;
    } catch (error) {
      this.#notice = {
        code: "invalid-hydration",
        message: `Persisted scenario data was ignored: ${error instanceof Error ? error.message : "invalid data"}`,
      };
      this.#remove(key);
      return null;
    }
  }

  save(record: CaseRecord): void {
    const validated = CaseRecordSchema.parse(record);
    const invariant = validateScenarioLog(validated.envelopes);
    if (!invariant.success) {
      throw new Error(invariant.reason ?? "Scenario log failed validation");
    }
    const key = this.#key(record.caseId);
    const serialized = JSON.stringify(validated);

    if (this.#primary) {
      try {
        this.#primary.setItem(key, serialized);
        this.#fallback.setItem(key, serialized);
        return;
      } catch {
        this.#primary = null;
        this.#notice = {
          code: "save-failed",
          message:
            "Browser persistence failed; the latest scenario state is retained in session memory.",
        };
      }
    }
    this.#fallback.setItem(key, serialized);
  }

  clear(caseId: string): void {
    this.#remove(this.#key(caseId));
  }

  #remove(key: string): void {
    if (this.#primary) {
      try {
        this.#primary.removeItem(key);
      } catch {
        this.#primary = null;
        this.#notice = {
          code: "storage-unavailable",
          message:
            "Browser persistence could not be cleared; the in-memory case was reset.",
        };
      }
    }
    this.#fallback.removeItem(key);
  }

  getNotice(): RepositoryNotice | null {
    return this.#notice;
  }
}
