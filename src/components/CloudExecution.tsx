import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, Route } from "lucide-react";
import type { CloudSession } from "../cloud";

interface Props {
  session: CloudSession;
  canRetry: boolean;
  busy: boolean;
  onRetry: () => Promise<void>;
}

const labels: Record<CloudSession["status"], string> = {
  active: "Agents are working",
  "approval-required": "Waiting for approval",
  approved: "Approval recorded",
  rejected: "Plan rejected",
  executing: "Executing business changes",
  "execution-failed": "Reroute needs retry",
  completed: "Execution completed",
};

export function CloudExecution({ session, canRetry, busy, onRetry }: Props) {
  const status = session.status;
  const completed = status === "completed";
  const failed = status === "execution-failed";
  const executing = status === "approved" || status === "executing";
  const relevant = session.events.filter((event) => [
    "remediation.plan.approved.v1", "logistics.reroute.requested.v1", "logistics.reroute.failed.v1",
    "logistics.reroute.completed.v1", "order.status.updated.v1", "customer.notification.sent.v1",
  ].includes(event.eventType));

  return <div className="cloud-execution" data-status={status}>
    <div className="cloud-execution-title">
      {completed ? <CheckCircle2 size={20} /> : failed ? <AlertTriangle size={20} /> : executing ? <Clock3 size={20} /> : <Route size={20} />}
      <div><strong>{labels[status]}</strong><span>{completed ? "Reroute, order updates, and customer notifications are complete." : failed ? "The first carrier quote expired. Retry with a refreshed quote." : executing ? "The approved plan is being applied to logistics and SAP order state." : "Execution starts only after approval."}</span></div>
    </div>
    {relevant.length ? <ol>{relevant.map((event) => <li key={event.eventId}><span>{event.eventType}</span><time>{new Date(event.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></li>)}</ol> : null}
    {failed && canRetry ? <button className="btn btn-primary" disabled={busy} onClick={() => void onRetry()}><RefreshCw size={15} /> Retry reroute</button> : null}
  </div>;
}
