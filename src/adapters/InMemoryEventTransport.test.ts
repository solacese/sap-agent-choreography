import { describe, expect, it, vi } from "vitest";
import { createDelayDetectedEnvelope } from "../application/scenarioEngine";
import { InMemoryEventTransport } from "./InMemoryEventTransport";

describe("InMemoryEventTransport", () => {
  it("delivers an event ID once and reports later deliveries as duplicates", async () => {
    const transport = new InMemoryEventTransport();
    const handler = vi.fn();
    transport.subscribe(handler);
    const envelope = createDelayDetectedEnvelope();

    const first = await transport.publish(envelope);
    const duplicate = await transport.publish(envelope);

    expect(first).toMatchObject({ delivered: true, duplicate: false });
    expect(duplicate).toMatchObject({ delivered: false, duplicate: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("can seed hydrated IDs and reset duplicate tracking", async () => {
    const transport = new InMemoryEventTransport();
    const envelope = createDelayDetectedEnvelope();
    transport.seedDelivered([envelope.eventId]);

    expect(await transport.publish(envelope)).toMatchObject({ duplicate: true });
    transport.reset();
    expect(await transport.publish(envelope)).toMatchObject({ delivered: true });
  });
});
