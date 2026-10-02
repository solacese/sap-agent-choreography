import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Cloud, Copy, LoaderCircle, QrCode, Smartphone, Users, X } from "lucide-react";
import QRCode from "qrcode";
import { cloudApi, loadRuntimeConfig, type CloudSession, type CreatedCloudSession } from "../cloud";

const storageKey = "sap-solace-cloud-session-v1";
type StoredSession = CreatedCloudSession;

export function CloudCollaboration() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const hashParams = useMemo(() => new URLSearchParams(window.location.hash.replace(/^#/, "")), []);
  const [available, setAvailable] = useState(false);
  const [data, setData] = useState<StoredSession | null>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? "null") as StoredSession | null; } catch { return null; }
  });
  const [joined, setJoined] = useState<{ session: CloudSession; token: string; role: string } | null>(null);
  const [open, setOpen] = useState(Boolean(params.get("code")));
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void loadRuntimeConfig().then((config) => setAvailable(config.mode === "cloud")); }, []);
  useEffect(() => {
    if (data?.approverUrl) void QRCode.toDataURL(data.approverUrl, { width: 240, margin: 1 }).then(setQr);
  }, [data?.approverUrl]);
  useEffect(() => {
    const sessionId = params.get("session");
    const approverToken = hashParams.get("token");
    const code = params.get("code");
    if (!available || joined) return;
    if (sessionId && approverToken && hashParams.get("role") === "approver") {
      void cloudApi.getSession(sessionId).then(({ session }) => setJoined({ session, token: approverToken, role: "approver" })).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not join session"));
    } else if (code) {
      void cloudApi.join(code).then(setJoined).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not join session"));
    }
  }, [available, hashParams, joined, params]);
  useEffect(() => {
    const sessionId = joined?.session.sessionId ?? data?.session.sessionId;
    if (!sessionId || !available) return;
    const timer = window.setInterval(() => {
      void cloudApi.getSession(sessionId).then(({ session }) => {
        if (joined) setJoined((current) => current ? { ...current, session } : current);
        if (data) setData((current) => current ? { ...current, session } : current);
      }).catch(() => undefined);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [available, data, joined]);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const created = await cloudApi.createSession();
      localStorage.setItem(storageKey, JSON.stringify(created));
      setData(created); setOpen(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create session"); }
    finally { setBusy(false); }
  };

  const act = async (action: string, token: string, session: CloudSession, body: Record<string, unknown> = {}) => {
    setBusy(true); setError(null);
    try {
      const result = await cloudApi.action(session.sessionId, token, action, body);
      if (joined) setJoined({ ...joined, session: result.session });
      if (data) setData({ ...data, session: result.session });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Cloud action failed"); }
    finally { setBusy(false); }
  };

  const session = joined?.session ?? data?.session;
  const token = joined?.token ?? data?.presenterToken;
  const isPhone = Boolean(joined);
  const allAgents = session ? Object.entries(session.agentStatus) : [];

  if (!available) return null;
  return (
    <section className="cloud-collaboration" aria-labelledby="cloud-title">
      <div className="cloud-summary">
        <span className="cloud-icon"><Cloud size={18} aria-hidden="true" /></span>
        <div><strong id="cloud-title">Solace connected demo</strong><span>Concurrent AWS agents · phone participation</span></div>
      </div>
      {!session ? (
        <button className="btn btn-primary" type="button" onClick={create} disabled={busy}>
          {busy ? <LoaderCircle size={15} className="spin" /> : <Smartphone size={15} />} Start phone session
        </button>
      ) : (
        <div className="cloud-actions">
          <span className="cloud-code">Join code <strong>{session.joinCode}</strong></span>
          <button className="btn" type="button" onClick={() => setOpen(true)}><QrCode size={15} /> Connect phones</button>
          {session.events.length === 0 && !isPhone ? <button className="btn btn-primary" type="button" onClick={() => void act("trigger", token!, session)} disabled={busy}>Start concurrent agents</button> : null}
        </div>
      )}

      {session ? <div className="integration-journey" aria-label="SAP and Solace integration journey">
        <span>SAP S/4HANA event</span><b>→</b><span>Solace AEM</span><b>→</b><span>Integration Suite guardrail</span><b>→</b><span>Parallel agents</span><b>→</b><span>Phone approval</span>
      </div> : null}

      {session && session.events.length > 0 ? (
        <div className="cloud-agents" aria-label="Concurrent agent activity">
          {allAgents.map(([name, state]) => <div className="cloud-agent" data-status={state} key={name}>
            {state === "running" ? <LoaderCircle size={16} className="spin" /> : state === "complete" ? <CheckCircle2 size={16} /> : <Cloud size={16} />}
            <span><strong>{name.replace("-", "/")}</strong><small>{state}</small></span>
          </div>)}
        </div>
      ) : null}

      {isPhone && session?.status === "approval-required" ? (
        <div className="phone-approval">
          <strong>Approval required</strong><span>Zeebrugge diversion · $38,000 · protects 3/3 SLAs</span>
          <div className="button-row">
            <button className="btn btn-success" onClick={() => void act("approve", token!, session, { actor: "Phone approver" })}>Approve</button>
            <button className="btn btn-danger" onClick={() => void act("reject", token!, session, { actor: "Phone approver" })}>Reject</button>
          </div>
        </div>
      ) : null}

      {error ? <div className="cloud-error" role="alert">{error}</div> : null}
      {open ? <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <div className="connect-dialog" role="dialog" aria-modal="true" aria-labelledby="connect-title">
          <button className="icon-button connect-close" aria-label="Close phone connection" onClick={() => setOpen(false)}><X size={18} /></button>
          <Smartphone size={28} color="var(--sap-link)" />
          <h2 id="connect-title">Join on a phone</h2>
          {qr ? <img src={qr} alt={`QR code to join session ${session?.joinCode}`} /> : null}
          <p>Scan the code or enter this session code:</p>
          <div className="join-code">{session?.joinCode ?? params.get("code")}</div>
          {data?.approverUrl ? <button className="btn" onClick={() => void navigator.clipboard.writeText(data.approverUrl)}><Copy size={15} /> Copy approver link</button> : null}
          <p className="connect-note"><Users size={14} /> This QR grants the short-lived approver role. Share the six-character code for view-and-vote access.</p>
        </div>
      </div> : null}
    </section>
  );
}
