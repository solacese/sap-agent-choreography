import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  Database,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type { ScenarioSnapshot } from "../application/scenarioRuntime";

interface OperationsSidebarProps {
  snapshot: ScenarioSnapshot;
  isBusy: boolean;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  onRetry: () => Promise<void>;
}

const time = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "UTC",
      }).format(new Date(value)) + " UTC"
    : "—";

export function OperationsSidebar({ snapshot, isBusy, onApprove, onReject, onRetry }: OperationsSidebarProps) {
  const { projection } = snapshot;
  const approval = projection.approval;
  const recommendation = projection.plans.find((plan) => plan.planId === projection.recommendedPlanId);

  return (
    <aside className="workspace-side" aria-label="Governance and execution">
      {approval.status === "pending" ? (
        <section className="approval-panel" aria-labelledby="approval-title">
          <div className="approval-title">
            <ShieldCheck size={22} color="var(--warning)" aria-hidden="true" />
            <h2 id="approval-title">Human approval required</h2>
          </div>
          <p>
            {recommendation?.title ?? approval.planId} protects all three customer
            commitments. Spend exceeds the auto-clear threshold, so the durable case
            is paused without holding a thread open.
          </p>
          <div className="approval-facts">
            <div className="approval-fact"><span>Plan</span><strong>{approval.planId}</strong></div>
            <div className="approval-fact"><span>Cost</span><strong>$38,000</strong></div>
            <div className="approval-fact"><span>Expires</span><strong>{time(approval.expiresAt)}</strong></div>
          </div>
          <div className="button-row" style={{ justifyContent: "flex-start" }}>
            <button className="btn btn-success" type="button" onClick={onApprove} disabled={isBusy}>
              <CheckCircle2 size={15} aria-hidden="true" /> Approve
            </button>
            <button className="btn btn-danger" type="button" onClick={onReject} disabled={isBusy}>
              <XCircle size={15} aria-hidden="true" /> Reject
            </button>
          </div>
          <p style={{ marginTop: 12, marginBottom: 0 }}>
            Synthetic approver: Anika Shah · Joule / mobile workflow
          </p>
        </section>
      ) : approval.status === "approved" || approval.status === "rejected" ? (
        <section className="panel content-panel" aria-labelledby="decision-title">
          <p className="section-kicker">Durable decision</p>
          <h2 id="decision-title" style={{ fontSize: "1rem" }}>
            {approval.status === "approved" ? "Plan approved" : "Plan rejected"}
          </h2>
          <p className="agent-copy">
            {approval.actor?.displayName} via {approval.actor?.channel} · {time(approval.decidedAt)}
          </p>
          <p className="agent-copy">“{approval.comment}”</p>
        </section>
      ) : (
        <section className="panel content-panel" aria-labelledby="approval-waiting-title">
          <p className="section-kicker">Human governance</p>
          <h2 id="approval-waiting-title" style={{ fontSize: "1rem" }}>Approval gate not reached</h2>
          <p className="agent-copy">
            The approval action is unavailable until the supervisor publishes a policy-backed recommendation.
          </p>
        </section>
      )}

      <section className="panel content-panel" aria-labelledby="execution-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">After approval only</p>
            <h2 id="execution-title">Execution timeline</h2>
          </div>
        </div>
        <ol className="execution-list">
          {projection.execution.map((step) => (
            <li className="execution-item" data-status={step.status} key={step.id}>
              <span className="timeline-icon" aria-hidden="true">
                {step.status === "complete" ? <Check size={14} /> : step.status === "failed" ? <AlertTriangle size={14} /> : step.status === "running" ? <Clock3 size={14} /> : <Circle size={10} />}
              </span>
              <div className="timeline-copy">
                <strong>{step.label}</strong>
                <span>{step.detail ?? (step.status === "waiting" ? "Blocked until prerequisite event" : step.status)}</span>
              </div>
            </li>
          ))}
        </ol>
        {snapshot.capabilities.canRetry ? (
          <button className="btn btn-primary" type="button" onClick={onRetry} disabled={isBusy}>
            <RefreshCw size={15} aria-hidden="true" /> Refresh quote & retry
          </button>
        ) : null}
      </section>

      <section className="panel content-panel" aria-labelledby="audit-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Traceability</p>
            <h2 id="audit-title">Audit trail</h2>
          </div>
        </div>
        {projection.audit.length ? (
          <ol className="audit-list">
            {[...projection.audit].reverse().map((record) => (
              <li className="audit-item" data-status="complete" key={record.eventId}>
                <span className="timeline-icon"><Check size={10} aria-hidden="true" /></span>
                <div>
                  <div className="audit-type">{record.eventType}</div>
                  <div className="audit-time">{time(record.occurredAt)} · {record.producer}</div>
                  <div className="audit-time">{record.summary}</div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="agent-copy">No business events published yet.</p>
        )}
      </section>

      <section className="panel content-panel" aria-labelledby="comparison-title">
        <p className="section-kicker">Operating model</p>
        <h2 id="comparison-title" style={{ fontSize: "1rem" }}>Event-driven vs. RAG</h2>
        <div className="comparison">
          <div className="comparison-side">
            <div className="comparison-label"><MessageSquareText size={12} /> RAG-only chat</div>
            <strong>AI answers questions</strong>
            <p>A person notices the problem, opens a chat and asks for analysis.</p>
          </div>
          <div className="comparison-side">
            <div className="comparison-label"><Bot size={12} /> Event-driven</div>
            <strong>AI participates in the process</strong>
            <p>The disruption event starts coordinated, policy-governed action.</p>
          </div>
        </div>
      </section>

      <section className="notice" aria-label="Persistence notice">
        <Database size={16} aria-hidden="true" />
        <span>
          {snapshot.persistenceNotice?.message ??
            "Scenario progress and its append-only event log persist in this browser's localStorage. No customer data leaves the device."}
        </span>
      </section>
    </aside>
  );
}
