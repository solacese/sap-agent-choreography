import { useMemo, useState } from "react";
import { BrainCircuit, CheckCircle2, CircleDot, Send } from "lucide-react";
import type { CloudSession } from "../cloud";

export type HumanAgentName = "sourcing" | "logistics" | "customer-sla" | "supervisor";

const briefs: Record<HumanAgentName, { title: string; brief: string; options: Array<{ id: string; label: string; detail: string }> }> = {
  sourcing: { title: "Sourcing agent", brief: "Choose a supply-side response without seeing Logistics' choice.", options: [
    { id: "regional-stock", label: "Regional safety stock", detail: "$12k · protects 2/3 SLAs" },
    { id: "air-critical", label: "Airfreight critical units", detail: "$58k · protects 3/3 SLAs" },
    { id: "hold", label: "Hold and expedite", detail: "$8.4k · protects 1/3 SLAs" },
  ] },
  logistics: { title: "Logistics agent", brief: "Choose a transport response without seeing Sourcing's choice.", options: [
    { id: "zeebrugge", label: "Divert via Zeebrugge", detail: "$38k · protects 3/3 SLAs" },
    { id: "priority-feeder", label: "Priority feeder", detail: "$27k · protects 2/3 SLAs" },
    { id: "current-route", label: "Keep current route", detail: "$0 · protects 0/3 SLAs" },
  ] },
  "customer-sla": { title: "Customer/SLA agent", brief: "Decide which business outcome should drive the recommendation.", options: [
    { id: "protect-platinum", label: "Prioritize Platinum", detail: "Protect the highest-value customer first" },
    { id: "protect-all", label: "Protect every SLA", detail: "Optimize for 3/3 promised dates" },
    { id: "cost-first", label: "Minimize cost", detail: "Accept lower-tier delays to protect margin" },
  ] },
  supervisor: { title: "Supervisor agent", brief: "Review all completed agent decisions and choose the plan sent to approval.", options: [
    { id: "HUMAN-LOGISTICS-01", label: "Recommend Zeebrugge", detail: "All SLAs protected; human spend approval required" },
    { id: "HUMAN-SOURCE-01", label: "Recommend safety stock", detail: "Lower cost; one SLA remains exposed" },
    { id: "HUMAN-SOURCE-02", label: "Recommend airfreight", detail: "Fastest; exceeds cost and margin guardrails" },
  ] },
};

interface Props {
  session: CloudSession;
  token: string;
  role: HumanAgentName;
  onSubmit: (role: HumanAgentName, optionId: string, rationale: string) => Promise<void>;
}

export function HumanAgentRole({ session, token, role, onSubmit }: Props) {
  void token;
  const brief = briefs[role];
  const [selected, setSelected] = useState(brief.options[0]?.id ?? "");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const complete = session.agentStatus[role] === "complete";
  const blocked = role === "supervisor" && !["sourcing", "logistics", "customer-sla"].every((agent) => session.agentStatus[agent as "sourcing" | "logistics" | "customer-sla"] === "complete");
  const result = useMemo(() => session.agentResults[role], [role, session.agentResults]);

  if (complete) return <div className="human-role-complete"><CheckCircle2 size={20} /><div><strong>{brief.title} submitted</strong><span>{String(result?.title ?? result?.recommendedPlanId ?? result?.recommendation ?? "Decision received")}</span></div></div>;
  return <div className="human-role-task">
    <div className="human-role-heading"><BrainCircuit size={20} /><div><strong>{brief.title}</strong><span>{blocked ? "Waiting for all three worker decisions" : brief.brief}</span></div></div>
    <div className="human-options" role="radiogroup" aria-label={`${brief.title} choices`}>
      {brief.options.map((option) => <button type="button" role="radio" aria-checked={selected === option.id} className="human-option" data-selected={selected === option.id} onClick={() => setSelected(option.id)} disabled={blocked} key={option.id}>
        <CircleDot size={16} /><span><strong>{option.label}</strong><small>{option.detail}</small></span>
      </button>)}
    </div>
    <label className="rationale-field">Why this choice?<textarea value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="Add your business rationale" disabled={blocked} /></label>
    <button className="btn btn-primary" disabled={blocked || busy || !selected} onClick={() => { setBusy(true); void onSubmit(role, selected, rationale).finally(() => setBusy(false)); }}><Send size={15} /> Submit as {brief.title}</button>
  </div>;
}
