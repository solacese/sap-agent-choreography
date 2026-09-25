import type { DomainEnvelope } from "../domain/eventSchemas";

export interface CaseRecord {
  readonly storageVersion: 1;
  readonly caseId: string;
  readonly savedAt: string;
  readonly envelopes: readonly DomainEnvelope[];
}

export type RepositoryNoticeCode =
  | "storage-unavailable"
  | "invalid-hydration"
  | "save-failed";

export interface RepositoryNotice {
  readonly code: RepositoryNoticeCode;
  readonly message: string;
}

export interface CaseRepository {
  load(caseId: string): CaseRecord | null;
  save(record: CaseRecord): void;
  clear(caseId: string): void;
  getNotice(): RepositoryNotice | null;
}
