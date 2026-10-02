import { useEffect, useMemo, useState } from "react";
import { Cloud, Copy, LoaderCircle, QrCode, Smartphone, Users, X } from "lucide-react";
import QRCode from "qrcode";
import { cloudApi, loadRuntimeConfig, type CloudSession, type CreatedCloudSession } from "../cloud";
import { HumanAgentRole, type HumanAgentName } from "./HumanAgentRole";

const storageKey = "sap-solace-cloud-session-v1";
const phoneStorageKey = "sap-solace-phone-role-v1";
type Joined = { session: CloudSession; token: string; role: string; claimedRole?: HumanAgentName };
const roleNames: HumanAgentName[] = ["sourcing", "logistics", "customer-sla", "supervisor"];

interface CloudCollaborationProps { phoneOnly?: boolean }

export function CloudCollaboration({ phoneOnly = false }: CloudCollaborationProps) {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const hashParams = useMemo(() => new URLSearchParams(window.location.hash.replace(/^#/, "")), []);
  const [available, setAvailable] = useState(false);
  const [transport, setTransport] = useState<"solace" | "aws-direct-fallback">("aws-direct-fallback");
  const [data, setData] = useState<CreatedCloudSession | null>(() => { try { return JSON.parse(localStorage.getItem(storageKey) ?? "null") as CreatedCloudSession | null; } catch { return null; } });
  const [joined, setJoined] = useState<Joined | null>(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(phoneStorageKey) ?? "null") as Joined | null;
      const requestedSession = params.get("session");
      return stored && (!requestedSession || stored.session.sessionId === requestedSession) ? stored : null;
    } catch { return null; }
  });
  const [open, setOpen] = useState(!phoneOnly && Boolean(params.get("code")));
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void loadRuntimeConfig().then((config) => { setAvailable(config.mode === "cloud"); setTransport(config.transport ?? "aws-direct-fallback"); }); }, []);
  const phoneJoinUrl = data?.joinUrl ? (() => { const url = new URL(data.joinUrl); url.searchParams.set("view", "phone"); return url.toString(); })() : undefined;
  const phoneApproverUrl = data?.approverUrl ? (() => { const url = new URL(data.approverUrl); url.searchParams.set("view", "phone"); return url.toString(); })() : undefined;
  useEffect(() => { if (phoneJoinUrl) void QRCode.toDataURL(phoneJoinUrl, { width: 240, margin: 1 }).then(setQr); }, [phoneJoinUrl]);
  useEffect(() => {
    const sessionId = params.get("session"); const approverToken = hashParams.get("token"); const code = params.get("code");
    if (!available || joined) return;
    if (sessionId && approverToken && hashParams.get("role") === "approver") void cloudApi.getSession(sessionId).then(({ session }) => setJoined({ session, token: approverToken, role: "approver" })).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not join session"));
    else if (code) void cloudApi.join(code).then((value) => { sessionStorage.setItem(phoneStorageKey, JSON.stringify(value)); setJoined(value); }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not join session"));
  }, [available, hashParams, joined, params]);
  useEffect(() => {
    const sessionId = joined?.session.sessionId ?? data?.session.sessionId;
    if (!sessionId || !available) return;
    const timer = window.setInterval(() => void cloudApi.getSession(sessionId).then(({ session }) => {
      setJoined((current) => current ? { ...current, session } : current);
      setData((current) => current ? { ...current, session } : current);
    }).catch(() => undefined), 3000);
    return () => window.clearInterval(timer);
  }, [available, data?.session.sessionId, joined?.session.sessionId]);

  const create = async () => { setBusy(true); setError(null); try { const created = await cloudApi.createSession(); localStorage.setItem(storageKey, JSON.stringify(created)); setData(created); setOpen(true); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create session"); } finally { setBusy(false); } };
  const act = async (action: string, actionToken: string, session: CloudSession, body: Record<string, unknown> = {}) => {
    setBusy(true); setError(null);
    try { const result = await cloudApi.action(session.sessionId, actionToken, action, body); setJoined((current) => current ? { ...current, session: result.session } : current); setData((current) => current ? { ...current, session: result.session } : current); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Cloud action failed"); } finally { setBusy(false); }
  };

  const rawSession = joined?.session ?? data?.session;
  const session = rawSession ? {
    ...rawSession,
    mode: rawSession.mode ?? "human-agents" as const,
    roleClaims: rawSession.roleClaims ?? {},
    agentResults: rawSession.agentResults ?? {},
    agentStatus: {
      sourcing: rawSession.agentStatus?.sourcing ?? "waiting",
      logistics: rawSession.agentStatus?.logistics ?? "waiting",
      "customer-sla": rawSession.agentStatus?.["customer-sla"] ?? "waiting",
      supervisor: rawSession.agentStatus?.supervisor ?? "waiting",
    },
  } : undefined;
  const actionToken = joined?.token ?? data?.presenterToken; const isPhone = Boolean(joined);
  const claimedRole = joined?.claimedRole ?? (joined && session ? roleNames.find((role) => session.roleClaims[role]?.subject && joined.token.includes(session.roleClaims[role]!.subject)) : undefined);
  const claimRole = async (role: HumanAgentName) => { if (!joined || !displayName.trim()) return; await act("claim-role", joined.token, joined.session, { agent: role, displayName: displayName.trim() }); setJoined((current) => { if (!current) return current; const next = { ...current, claimedRole: role }; sessionStorage.setItem(phoneStorageKey, JSON.stringify(next)); return next; }); };

  if (!available) return null;
  return <section className={phoneOnly ? "cloud-collaboration phone-only-card" : "cloud-collaboration"} aria-labelledby="cloud-title">
    <div className="cloud-summary"><span className="cloud-icon"><Cloud size={18} /></span><div><strong id="cloud-title">{transport === "solace" ? "Solace multiplayer demo" : "Cloud multiplayer preview"}</strong><span>{transport === "solace" ? "Solace AEM · people become agents · phone approval" : "People become agents · phone approval · Solace connection pending"}</span></div></div>
    {!session && !phoneOnly ? <button className="btn btn-primary" onClick={create} disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Smartphone size={15} />} Start multiplayer session</button> : session ? <div className="cloud-actions">
      <span className="cloud-code">Session <strong>{session.joinCode}</strong></span>{!phoneOnly ? <button className="btn" onClick={() => setOpen(true)}><QrCode size={15} /> Connect players</button> : null}
      {!isPhone && !phoneOnly && session.events.length === 0 ? <><button className="btn" onClick={() => void act("mode", actionToken!, session, { mode: session.mode === "human-agents" ? "autonomous" : "human-agents" })}>{session.mode === "human-agents" ? "Human agents" : "Autonomous"}</button><button className="btn btn-primary" onClick={() => void act("trigger", actionToken!, session)} disabled={busy}>Start scenario</button></> : null}
    </div> : phoneOnly ? <div className="phone-loading"><LoaderCircle size={18} className="spin" /> Joining session…</div> : null}

    {session ? <><div className="integration-journey"><span>SAP S/4HANA event</span><b>→</b><span>Solace AEM</span><b>→</b><span>Human agent teams</span><b>→</b><span>Supervisor</span><b>→</b><span>Approval</span></div>
      <div className="role-board" aria-label="Multiplayer roles">{roleNames.map((role) => <div className="role-seat" data-status={session.agentStatus[role]} key={role}><span><strong>{role.replace("-", "/")}</strong><small>{session.roleClaims[role]?.displayName ?? "Open seat"}</small></span><em>{session.agentStatus[role]}</em></div>)}</div></> : null}

    {isPhone && joined?.role === "participant" && !claimedRole ? <div className="role-picker"><h2>Choose your agent role</h2><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your name" aria-label="Your name" /><div className="role-buttons">{roleNames.map((role) => <button className="human-option" disabled={Boolean(session?.roleClaims[role]) || !displayName.trim()} onClick={() => void claimRole(role)} key={role}><Users size={16} /><span><strong>{role.replace("-", "/")}</strong><small>{session?.roleClaims[role] ? `Claimed by ${session.roleClaims[role]?.displayName}` : "Claim role"}</small></span></button>)}</div></div> : null}
    {isPhone && joined?.role === "participant" && claimedRole && session ? <HumanAgentRole session={session} token={joined.token} role={claimedRole} onSubmit={(role, optionId, rationale) => act("submit-decision", joined.token, session, { agent: role, optionId, rationale })} /> : null}
    {isPhone && joined?.role === "approver" && session?.status === "approval-required" ? <div className="phone-approval"><strong>Approval required</strong><span>Participant Supervisor recommendation · apply policy and authorize execution</span><div className="button-row"><button className="btn btn-success" onClick={() => void act("approve", joined.token, session, { actor: "Phone approver" })}>Approve</button><button className="btn btn-danger" onClick={() => void act("reject", joined.token, session, { actor: "Phone approver" })}>Reject</button></div></div> : null}
    {error ? <div className="cloud-error" role="alert">{error}</div> : null}

    {open ? <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}><div className="connect-dialog" role="dialog" aria-modal="true" aria-labelledby="connect-title"><button className="icon-button connect-close" aria-label="Close phone connection" onClick={() => setOpen(false)}><X size={18} /></button><Smartphone size={28} color="var(--sap-link)" /><h2 id="connect-title">Join the agent team</h2>{qr ? <img src={qr} alt={`QR code to join session ${session?.joinCode}`} /> : null}<p>Scan to claim an agent role, or enter:</p><div className="join-code">{session?.joinCode ?? params.get("code")}</div>{phoneJoinUrl ? <button className="btn" onClick={() => void navigator.clipboard.writeText(phoneJoinUrl)}><Copy size={15} /> Copy participant link</button> : null}{phoneApproverUrl ? <button className="btn" onClick={() => void navigator.clipboard.writeText(phoneApproverUrl)}><Copy size={15} /> Copy approver link</button> : null}<p className="connect-note"><Users size={14} /> Participants independently claim roles. Keep the approver link separate.</p></div></div> : null}
  </section>;
}
