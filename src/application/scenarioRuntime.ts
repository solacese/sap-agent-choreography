import { InMemoryEventTransport } from "../adapters/InMemoryEventTransport";
import { LocalStorageCaseRepository } from "../adapters/LocalStorageCaseRepository";
import {
  parseDomainEnvelopeLog,
  type DomainEnvelope,
} from "../domain/eventSchemas";
import { CASE_ID } from "../fixtures/mvHorizonScenario";
import type { CaseRepository, RepositoryNotice } from "../ports/CaseRepository";
import type { DeliveryReceipt, EventTransport } from "../ports/EventTransport";
import { projectCase, type CaseProjection } from "./caseProjector";
import {
  createApprovalEnvelope,
  createDelayDetectedEnvelope,
  nextScenarioTransition,
  retryScenarioTransition,
  validateScenarioLog,
  type TransitionBlockReason,
} from "./scenarioEngine";

export type RuntimeAction =
  | "hydrate"
  | "trigger"
  | "step"
  | "approve"
  | "reject"
  | "retry"
  | "reset"
  | "replay-log"
  | "replay-delivery";

export interface RuntimeActivity {
  readonly action: RuntimeAction;
  readonly message: string;
  readonly envelopeIds: readonly string[];
  readonly duplicate: boolean;
}

export interface RuntimeCapabilities {
  readonly canTrigger: boolean;
  readonly canStep: boolean;
  readonly canApprove: boolean;
  readonly canReject: boolean;
  readonly canRetry: boolean;
  readonly canReset: boolean;
}

export interface ScenarioSnapshot {
  readonly caseId: string;
  readonly projection: CaseProjection;
  readonly envelopes: readonly DomainEnvelope[];
  readonly capabilities: RuntimeCapabilities;
  readonly persistenceNotice: RepositoryNotice | null;
  readonly lastActivity: RuntimeActivity | null;
  readonly revision: number;
}

export interface RuntimeActionResult {
  readonly accepted: boolean;
  readonly reason: TransitionBlockReason | "invalid-action" | null;
  readonly receipts: readonly DeliveryReceipt[];
}

export interface ScenarioRuntimeOptions {
  readonly transport?: EventTransport;
  readonly repository?: CaseRepository;
  readonly caseId?: string;
}

const emptyResult = (
  reason: RuntimeActionResult["reason"],
): RuntimeActionResult => ({ accepted: false, reason, receipts: [] });

export class ScenarioRuntime {
  readonly #caseId: string;
  readonly #transport: EventTransport;
  readonly #repository: CaseRepository;
  readonly #listeners = new Set<() => void>();
  readonly #unsubscribeTransport: () => void;
  #log: DomainEnvelope[];
  #revision = 0;
  #lastActivity: RuntimeActivity | null = null;
  #snapshot: ScenarioSnapshot;

  constructor(options: ScenarioRuntimeOptions = {}) {
    this.#caseId = options.caseId ?? CASE_ID;
    this.#transport = options.transport ?? new InMemoryEventTransport();
    this.#repository = options.repository ?? new LocalStorageCaseRepository();

    const hydrated = this.#repository.load(this.#caseId);
    this.#log = hydrated ? parseDomainEnvelopeLog(hydrated.envelopes) : [];
    this.#transport.seedDelivered?.(this.#log.map((envelope) => envelope.eventId));
    this.#lastActivity = hydrated
      ? {
          action: "hydrate",
          message: `Restored ${this.#log.length} durable envelopes from browser persistence.`,
          envelopeIds: this.#log.map((envelope) => envelope.eventId),
          duplicate: false,
        }
      : null;

    this.#snapshot = this.#buildSnapshot();
    this.#unsubscribeTransport = this.#transport.subscribe((envelope) => {
      if (this.#log.some((item) => item.eventId === envelope.eventId)) return;
      const nextLog = [...this.#log, envelope];
      const validation = validateScenarioLog(nextLog);
      if (!validation.success) {
        throw new Error(validation.reason ?? "Transport delivered an invalid transition");
      }
      this.#log = nextLog;
      this.#persist();
      this.#refresh();
    });
  }

  /** React useSyncExternalStore-compatible subscription. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Stable snapshot identity until the runtime changes. */
  getSnapshot = (): ScenarioSnapshot => this.#snapshot;

  async trigger(): Promise<RuntimeActionResult> {
    if (this.#log.length > 0) return emptyResult("invalid-action");
    return this.#publish(
      "trigger",
      [createDelayDetectedEnvelope()],
      "Vessel delay published without a human prompt.",
    );
  }

  async step(): Promise<RuntimeActionResult> {
    const transition = nextScenarioTransition(this.#log);
    if (transition.envelopes.length === 0) {
      this.#recordBlockedActivity("step", transition.blockedBy);
      return emptyResult(transition.blockedBy ?? "invalid-action");
    }
    return this.#publish(
      "step",
      transition.envelopes,
      transition.envelopes.length > 1
        ? "Independent sourcing and logistics proposals were published in parallel."
        : `${transition.envelopes[0]?.eventType ?? "Transition"} published.`,
    );
  }

  async approve(
    comment = "Approved to protect customer delivery commitments.",
  ): Promise<RuntimeActionResult> {
    if (this.#snapshot.projection.approval.status !== "pending") {
      return emptyResult("invalid-action");
    }
    return this.#publish(
      "approve",
      [createApprovalEnvelope("approved", comment)],
      "Human approval recorded durably; execution is now allowed.",
    );
  }

  async reject(
    reason = "Rejected; revise the remediation plan before execution.",
  ): Promise<RuntimeActionResult> {
    if (this.#snapshot.projection.approval.status !== "pending") {
      return emptyResult("invalid-action");
    }
    return this.#publish(
      "reject",
      [createApprovalEnvelope("rejected", reason)],
      "Human rejection recorded; execution is permanently blocked for this case.",
    );
  }

  async retry(): Promise<RuntimeActionResult> {
    const transition = retryScenarioTransition(this.#log);
    if (transition.envelopes.length === 0) {
      return emptyResult(transition.blockedBy ?? "invalid-action");
    }
    return this.#publish(
      "retry",
      transition.envelopes,
      "Expired carrier quote refreshed; reroute retry requested.",
    );
  }

  reset(): RuntimeActionResult {
    this.#log = [];
    this.#transport.reset();
    this.#repository.clear(this.#caseId);
    this.#lastActivity = {
      action: "reset",
      message: "Scenario and durable event log reset to the initial state.",
      envelopeIds: [],
      duplicate: false,
    };
    this.#refresh();
    return { accepted: true, reason: null, receipts: [] };
  }

  /** Rebuilds projection from validated existing envelopes without publishing new ones. */
  replayLog(): RuntimeActionResult {
    const replayed = parseDomainEnvelopeLog(
      JSON.parse(JSON.stringify(this.#log)) as unknown,
    );
    const validation = validateScenarioLog(replayed);
    if (!validation.success) return emptyResult("invalid-action");

    this.#log = replayed;
    this.#lastActivity = {
      action: "replay-log",
      message: `Replayed ${replayed.length} envelopes to rebuild the same case projection; no new events were created.`,
      envelopeIds: replayed.map((envelope) => envelope.eventId),
      duplicate: false,
    };
    this.#refresh();
    return { accepted: true, reason: null, receipts: [] };
  }

  /** Republishes one envelope with the same ID to demonstrate transport idempotency. */
  async replayDelivery(eventId: string): Promise<RuntimeActionResult> {
    const envelope = this.#log.find((item) => item.eventId === eventId);
    if (!envelope) return emptyResult("invalid-action");

    const receipt = await this.#transport.publish(envelope);
    this.#lastActivity = {
      action: "replay-delivery",
      message: receipt.duplicate
        ? `Duplicate ${eventId} ignored; the case projection did not advance.`
        : `${eventId} was delivered again.`,
      envelopeIds: [eventId],
      duplicate: receipt.duplicate,
    };
    this.#refresh();
    return {
      accepted: true,
      reason: null,
      receipts: [receipt],
    };
  }

  dispose(): void {
    this.#unsubscribeTransport();
    this.#listeners.clear();
  }

  async #publish(
    action: RuntimeAction,
    envelopes: readonly DomainEnvelope[],
    message: string,
  ): Promise<RuntimeActionResult> {
    const receipts = await Promise.all(
      envelopes.map((envelope) => this.#transport.publish(envelope)),
    );
    const deliveredIds = receipts
      .filter((receipt) => receipt.delivered)
      .map((receipt) => receipt.envelopeId);
    this.#lastActivity = {
      action,
      message,
      envelopeIds: deliveredIds,
      duplicate: receipts.some((receipt) => receipt.duplicate),
    };
    this.#refresh();
    return {
      accepted: deliveredIds.length > 0,
      reason: deliveredIds.length > 0 ? null : "invalid-action",
      receipts,
    };
  }

  #recordBlockedActivity(
    action: RuntimeAction,
    reason: TransitionBlockReason | null,
  ): void {
    const message =
      reason === "approval-required"
        ? "Execution is paused at the durable human approval gate."
        : reason === "retry-required"
          ? "The failed reroute must be retried explicitly."
          : reason === "rejected"
            ? "The rejected case is terminal and cannot execute."
            : reason === "completed"
              ? "The scenario is already complete."
              : "Trigger the vessel delay before advancing the scenario.";
    this.#lastActivity = {
      action,
      message,
      envelopeIds: [],
      duplicate: false,
    };
    this.#refresh();
  }

  #persist(): void {
    const savedAt =
      this.#log.at(-1)?.occurredAt ?? "2026-04-14T08:00:00.000Z";
    this.#repository.save({
      storageVersion: 1,
      caseId: this.#caseId,
      savedAt,
      envelopes: this.#log,
    });
  }

  #buildSnapshot(): ScenarioSnapshot {
    const projection = projectCase(this.#log);
    return {
      caseId: this.#caseId,
      projection,
      envelopes: [...this.#log],
      capabilities: {
        canTrigger: this.#log.length === 0,
        canStep:
          projection.status !== "idle" &&
          projection.status !== "awaiting-approval" &&
          projection.status !== "execution-failed" &&
          projection.status !== "rejected" &&
          projection.status !== "completed",
        canApprove: projection.approval.status === "pending",
        canReject: projection.approval.status === "pending",
        canRetry: projection.status === "execution-failed",
        canReset: this.#log.length > 0,
      },
      persistenceNotice: this.#repository.getNotice(),
      lastActivity: this.#lastActivity,
      revision: this.#revision,
    };
  }

  #refresh(): void {
    this.#revision += 1;
    this.#snapshot = this.#buildSnapshot();
    for (const listener of this.#listeners) listener();
  }
}

export function createScenarioRuntime(
  options: ScenarioRuntimeOptions = {},
): ScenarioRuntime {
  return new ScenarioRuntime(options);
}
