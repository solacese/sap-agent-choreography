import type { DomainEnvelope } from "../domain/eventSchemas";
import type {
  DeliveryReceipt,
  EnvelopeHandler,
  EventTransport,
} from "../ports/EventTransport";

export class InMemoryEventTransport implements EventTransport {
  readonly #handlers = new Set<EnvelopeHandler>();
  readonly #deliveredIds = new Set<string>();

  async publish(envelope: DomainEnvelope): Promise<DeliveryReceipt> {
    if (this.#deliveredIds.has(envelope.eventId)) {
      return {
        envelopeId: envelope.eventId,
        delivered: false,
        duplicate: true,
        deliveredTo: 0,
      };
    }

    this.#deliveredIds.add(envelope.eventId);
    const handlers = [...this.#handlers];
    await Promise.all(handlers.map((handler) => handler(envelope)));

    return {
      envelopeId: envelope.eventId,
      delivered: true,
      duplicate: false,
      deliveredTo: handlers.length,
    };
  }

  subscribe(handler: EnvelopeHandler): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  seedDelivered(envelopeIds: readonly string[]): void {
    for (const envelopeId of envelopeIds) {
      this.#deliveredIds.add(envelopeId);
    }
  }

  reset(): void {
    this.#deliveredIds.clear();
  }
}
