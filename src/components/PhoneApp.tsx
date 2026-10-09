import { RadioTower, ShieldCheck, Smartphone } from "lucide-react";
import { CloudCollaboration } from "./CloudCollaboration";

export function PhoneApp() {
  return <div className="phone-app">
    <header className="phone-shell">
      <div className="phone-brand"><span>SAP</span><b>Agent Mission</b></div>
      <Smartphone size={20} aria-hidden="true" />
    </header>
    <main className="phone-main">
      <div className="phone-hero">
        <span className="phone-live"><RadioTower size={14} /> Live mission</span>
        <h1>MV Horizon response</h1>
        <p>Choose a role. Make one business decision when your step unlocks.</p>
      </div>
      <CloudCollaboration phoneOnly />
      <div className="phone-safety"><ShieldCheck size={17} /><span>Your decision is advisory until the Supervisor and independent Approver complete the governance gates.</span></div>
    </main>
  </div>;
}
