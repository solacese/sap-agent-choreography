import {
  AlertTriangle,
  Check,
  Clock3,
  FileCheck2,
  Gauge,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { CaseProjection } from "../application/caseProjector";

interface OverviewProps {
  projection: CaseProjection;
}

const stageDescriptions = [
  "Carrier delay detected; no human, no prompt.",
  "Impact agent resolves affected orders.",
  "Sourcing and logistics work in parallel.",
  "Supervisor scores options against policy.",
  "Human gate may wait hours or days.",
  "Reroute, update orders, notify customers.",
] as const;

const stageStatusLabels = {
  waiting: "Waiting",
  running: "Running",
  complete: "Complete",
  "approval-required": "Approval required",
  failed: "Failed",
  "revision-needed": "Revision needed",
} as const;

function StageIcon({ status, number }: { status: CaseProjection["stages"][number]["status"]; number: number }) {
  if (status === "complete") return <Check size={18} aria-hidden="true" />;
  if (status === "failed" || status === "revision-needed") {
    return <AlertTriangle size={18} aria-hidden="true" />;
  }
  if (status === "approval-required") return <ShieldCheck size={18} aria-hidden="true" />;
  return <span>{number}</span>;
}

export function Overview({ projection }: OverviewProps) {
  const exposure = projection.orders.reduce((sum, order) => sum + order.slaExposureUsd, 0);
  const gate =
    projection.approval.status === "pending"
      ? "Human review"
      : projection.status === "execution-failed"
        ? "Retry required"
        : projection.status === "completed"
          ? "Closed"
          : projection.status === "rejected"
            ? "Rejected"
            : "In progress";

  return (
    <>
      <section className="kpi-grid" aria-label="Case key performance indicators">
        <article className="kpi-card" style={{ "--kpi-accent": "var(--warning)" } as React.CSSProperties}>
          <span className="kpi-label"><Clock3 size={14} /> Vessel delay</span>
          <div className="kpi-value">36h</div>
          <div className="kpi-note">Singapore → Rotterdam</div>
        </article>
        <article className="kpi-card" style={{ "--kpi-accent": "var(--blue)" } as React.CSSProperties}>
          <span className="kpi-label"><Users size={14} /> Orders at risk</span>
          <div className="kpi-value">{projection.orders.length || "—"}</div>
          <div className="kpi-note">Across Platinum, Gold and Silver tiers</div>
        </article>
        <article className="kpi-card" style={{ "--kpi-accent": "var(--danger)" } as React.CSSProperties}>
          <span className="kpi-label"><Gauge size={14} /> SLA exposure</span>
          <div className="kpi-value">{exposure ? `$${(exposure / 1000).toFixed(1)}K` : "—"}</div>
          <div className="kpi-note">Deterministic projected service credits</div>
        </article>
        <article className="kpi-card" style={{ "--kpi-accent": "var(--success)" } as React.CSSProperties}>
          <span className="kpi-label"><FileCheck2 size={14} /> Current gate</span>
          <div className="kpi-value" style={{ fontSize: "1.35rem" }}>{gate}</div>
          <div className="kpi-note">Execution remains policy controlled</div>
        </article>
      </section>

      <section className="panel stage-panel" aria-labelledby="journey-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Case choreography</p>
            <h2 id="journey-title">Six-stage business response</h2>
          </div>
          <p>Every status is projected from the append-only envelope log.</p>
        </div>
        <ol className="stage-rail">
          {projection.stages.map((stage, index) => (
            <li
              className="stage-item"
              data-status={stage.status}
              key={stage.id}
              aria-current={stage.status === "running" || stage.status === "approval-required" || stage.status === "failed" ? "step" : undefined}
            >
              <span className="stage-node">
                <StageIcon status={stage.status} number={stage.number} />
              </span>
              <div>
                <div className="stage-title">{stage.label}</div>
                <div className="stage-subtitle">{stageDescriptions[index]}</div>
              </div>
              <span className="status-label">{stageStatusLabels[stage.status]}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
