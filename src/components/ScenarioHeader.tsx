import {
  CircleStop,
  FastForward,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Ship,
  StepForward,
  X,
} from "lucide-react";
import type { ScenarioSnapshot } from "../application/scenarioRuntime";

interface ScenarioHeaderProps {
  snapshot: ScenarioSnapshot;
  isPlaying: boolean;
  isBusy: boolean;
  confirmReset: boolean;
  onTrigger: () => void;
  onStep: () => void;
  onTogglePlay: () => void;
  onReplay: () => void;
  onRequestReset: () => void;
  onConfirmReset: () => void;
  onCancelReset: () => void;
}

const statusLabel: Record<ScenarioSnapshot["projection"]["status"], string> = {
  idle: "Ready to simulate",
  running: "Choreography active",
  "awaiting-approval": "Awaiting human approval",
  "execution-failed": "Execution needs retry",
  rejected: "Plan rejected",
  completed: "Case completed",
};

export function ScenarioHeader({
  snapshot,
  isPlaying,
  isBusy,
  confirmReset,
  onTrigger,
  onStep,
  onTogglePlay,
  onReplay,
  onRequestReset,
  onConfirmReset,
  onCancelReset,
}: ScenarioHeaderProps) {
  const { projection, capabilities } = snapshot;
  const currentStage =
    projection.stages.find((stage) => stage.status !== "complete") ??
    projection.stages.at(-1);

  return (
    <>
      <header className="topbar">
        <div className="topbar-grid" aria-hidden="true" />
        <div className="container topbar-inner">
          <div>
            <p className="eyebrow">Event-driven supply chain operations</p>
            <h1>MV Horizon disruption control tower</h1>
            <p className="topbar-copy">
              A deterministic demonstration of agents coordinating through an event
              backbone—from carrier signal to approved business execution.
            </p>
          </div>
          <div className="case-meta" aria-label="Case metadata">
            <div className="mode-badge">
              <span className="mode-dot" aria-hidden="true" />
              SIMULATED — NO LIVE SAP OR AEM CONNECTION
            </div>
            <div className="case-meta-row">
              <span>Active case</span>
              <strong>{snapshot.caseId}</strong>
            </div>
            <div className="case-meta-row">
              <span>Vessel / voyage</span>
              <strong>MV Horizon · HZ-0426W</strong>
            </div>
            <div className="case-meta-row">
              <span>Event backbone</span>
              <strong>In-memory AEM boundary</strong>
            </div>
          </div>
        </div>
      </header>

      <nav className="command-bar" aria-label="Scenario controls">
        <div className="container command-inner">
          <div className="command-context">
            <span className="stage-marker" aria-hidden="true">
              {isPlaying ? <Radio size={18} /> : <Ship size={18} />}
            </span>
            <div>
              <strong>{statusLabel[projection.status]}</strong>
              <span>
                Stage {currentStage?.number ?? 1} of 6 · {currentStage?.label ?? "Signal"}
              </span>
            </div>
          </div>

          <div className="button-row">
            <button
              className="btn btn-primary"
              type="button"
              onClick={onTrigger}
              disabled={!capabilities.canTrigger || isBusy}
            >
              <Radio size={15} aria-hidden="true" />
              Trigger vessel delay
            </button>
            <button
              className="btn"
              type="button"
              onClick={onStep}
              disabled={!capabilities.canStep || isBusy || isPlaying}
            >
              <StepForward size={15} aria-hidden="true" />
              Step forward
            </button>
            <button
              className="btn"
              type="button"
              onClick={onTogglePlay}
              disabled={
                isBusy ||
                projection.status === "idle" ||
                projection.status === "execution-failed" ||
                projection.status === "rejected" ||
                projection.status === "completed"
              }
              aria-pressed={isPlaying}
            >
              {isPlaying ? (
                <Pause size={15} aria-hidden="true" />
              ) : (
                <Play size={15} aria-hidden="true" />
              )}
              {isPlaying ? "Pause demo" : "Run demo"}
            </button>
            <button
              className="btn"
              type="button"
              onClick={onReplay}
              disabled={snapshot.envelopes.length === 0 || isBusy}
            >
              <FastForward size={15} aria-hidden="true" />
              Replay log
            </button>
            {!confirmReset ? (
              <button
                className="btn btn-quiet"
                type="button"
                onClick={onRequestReset}
                disabled={!capabilities.canReset || isBusy}
              >
                <RotateCcw size={15} aria-hidden="true" />
                Reset
              </button>
            ) : (
              <span role="group" aria-label="Confirm scenario reset" className="button-row">
                <button className="btn btn-danger" type="button" onClick={onConfirmReset}>
                  <CircleStop size={15} aria-hidden="true" />
                  Confirm reset
                </button>
                <button className="btn btn-quiet" type="button" onClick={onCancelReset}>
                  <X size={15} aria-hidden="true" />
                  Cancel
                </button>
              </span>
            )}
          </div>
        </div>
      </nav>
    </>
  );
}
