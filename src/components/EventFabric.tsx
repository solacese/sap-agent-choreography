import { useEffect, useRef, useState } from "react";
import { CopyCheck, RadioTower, RotateCw, X } from "lucide-react";
import type { DomainEnvelope } from "../domain/eventSchemas";

interface EventFabricProps {
  envelopes: readonly DomainEnvelope[];
  duplicateMessage: string | null;
  onReplayDelivery: (eventId: string) => Promise<void>;
}

const formatTime = (value: string) =>
  new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(value));

interface EventDetailProps {
  envelope: DomainEnvelope;
  onClose: () => void;
  onReplayDelivery: (eventId: string) => Promise<void>;
  returnFocus: HTMLElement | null;
}

function EventDetail({ envelope, onClose, onReplayDelivery, returnFocus }: EventDetailProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [replaying, setReplaying] = useState(false);

  useEffect(() => {
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocus?.focus();
    };
  }, [onClose, returnFocus]);

  const replay = async () => {
    setReplaying(true);
    try {
      await onReplayDelivery(envelope.eventId);
    } finally {
      setReplaying(false);
    }
  };

  const details = [
    ["Envelope ID", envelope.eventId],
    ["Kind", envelope.kind],
    ["Occurred (UTC)", envelope.occurredAt],
    ["Schema", envelope.schemaVersion],
    ["Correlation ID", envelope.correlationId],
    ["Causation ID", envelope.causationId ?? "Root event"],
    ["Producer", envelope.producer],
    ["Consumers", envelope.consumers.join(", ")],
    ["Topic", envelope.topic],
    ["Related events", envelope.relatedEventIds.join(", ") || "None"],
  ] as const;

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-detail-title"
        aria-describedby="event-detail-description"
      >
        <div className="dialog-header">
          <div>
            <p className="section-kicker">{envelope.kind} envelope</p>
            <h2 id="event-detail-title">{envelope.eventType}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            ref={closeRef}
            aria-label="Close event details"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p id="event-detail-description" className="agent-copy" style={{ marginTop: 16 }}>
          Canonical simulated envelope carried through the in-memory event transport.
        </p>
        <div className="detail-grid">
          {details.map(([label, value]) => (
            <div className="detail-item" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <p className="agent-section-label">Typed payload</p>
        <pre className="json-view">{JSON.stringify(envelope.payload, null, 2)}</pre>
        <button className="btn" type="button" onClick={replay} disabled={replaying}>
          <CopyCheck size={15} aria-hidden="true" />
          {replaying ? "Delivering…" : "Replay delivery with same ID"}
        </button>
        <p className="agent-copy" style={{ marginTop: 10, marginBottom: 0 }}>
          This republishes the exact envelope to demonstrate idempotency. The event log
          and business projection will not advance.
        </p>
      </div>
    </div>
  );
}

export function EventFabric({ envelopes, duplicateMessage, onReplayDelivery }: EventFabricProps) {
  const [selected, setSelected] = useState<DomainEnvelope | null>(null);
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);

  const closeDetail = () => setSelected(null);

  return (
    <section className="event-section" aria-labelledby="event-fabric-title">
      <div className="event-header">
        <div className="event-title">
          <RadioTower size={20} aria-hidden="true" />
          <div>
            <h2 id="event-fabric-title">Event fabric</h2>
            <span className="live-pill">Simulated AEM transport</span>
          </div>
        </div>
        <span className="event-count">
          {envelopes.length} envelope{envelopes.length === 1 ? "" : "s"} · append only
        </span>
      </div>
      <div className="fabric-lane" tabIndex={0} aria-label="Scrollable event envelope lane">
        <div className="fabric-track">
          {envelopes.length === 0 ? (
            <div className="empty-fabric">
              <RadioTower size={25} aria-hidden="true" />
              <span>Trigger the vessel delay to publish the first business event.</span>
            </div>
          ) : (
            envelopes.map((envelope, index) => (
              <button
                className="event-chip"
                data-kind={envelope.kind}
                type="button"
                key={envelope.eventId}
                onClick={(event) => {
                  setReturnFocus(event.currentTarget);
                  setSelected(envelope);
                }}
              >
                <span className="event-type">{envelope.eventType}</span>
                <span className="event-meta">
                  <span>{envelope.kind}</span>
                  <span>{String(index + 1).padStart(2, "0")} · {formatTime(envelope.occurredAt)}Z</span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
      {duplicateMessage ? (
        <div className="event-header" role="status">
          <span className="live-pill"><RotateCw size={13} /> Duplicate ignored</span>
          <span className="event-count">{duplicateMessage}</span>
        </div>
      ) : null}
      {selected ? (
        <EventDetail
          envelope={selected}
          onClose={closeDetail}
          onReplayDelivery={onReplayDelivery}
          returnFocus={returnFocus}
        />
      ) : null}
    </section>
  );
}
