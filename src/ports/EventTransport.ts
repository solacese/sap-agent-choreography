import type { DomainEnvelope } from "../domain/eventSchemas";

export interface DeliveryReceipt {
  readonly envelopeId: string;
  readonly delivered: boolean;
  readonly duplicate: boolean;
  readonly deliveredTo: number;
}

export type EnvelopeHandler = (
  envelope: DomainEnvelope,
) => void | Promise<void>;

export interface EventTransport {
  publish(envelope: DomainEnvelope): Promise<DeliveryReceipt>;
  subscribe(handler: EnvelopeHandler): () => void;
  /** Seed durable IDs after hydration so redelivery remains idempotent. */
  seedDelivered?(envelopeIds: readonly string[]): void;
  reset(): void;
}
