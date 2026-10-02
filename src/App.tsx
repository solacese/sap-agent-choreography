import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import {
  createScenarioRuntime,
  type RuntimeActionResult,
  type ScenarioRuntime,
} from "./application/scenarioRuntime";
import { AgentWorkbench } from "./components/AgentWorkbench";
import { EventFabric } from "./components/EventFabric";
import { OperationsSidebar } from "./components/OperationsSidebar";
import { Overview } from "./components/Overview";
import { ScenarioHeader } from "./components/ScenarioHeader";
import { CloudCollaboration } from "./components/CloudCollaboration";

const browserRuntime = createScenarioRuntime();
const AUTOPLAY_INTERVAL_MS = 900;

interface AppProps {
  runtime?: ScenarioRuntime;
}

export default function App({ runtime = browserRuntime }: AppProps) {
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const resumeAfterApproval = useRef(false);

  const runAction = useCallback(
    async (action: () => RuntimeActionResult | Promise<RuntimeActionResult>) => {
      setIsBusy(true);
      setActionError(null);
      try {
        const result = await action();
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected runtime error";
        setActionError(`Action failed: ${message}`);
        return null;
      } finally {
        setIsBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isPlaying || isBusy || !snapshot.capabilities.canStep) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        await runAction(() => runtime.step());
        const status = runtime.getSnapshot().projection.status;
        if (status === "awaiting-approval") {
          resumeAfterApproval.current = true;
          setIsPlaying(false);
        } else if (
          status === "execution-failed" ||
          status === "completed" ||
          status === "rejected"
        ) {
          resumeAfterApproval.current = false;
          setIsPlaying(false);
        }
      })();
    }, AUTOPLAY_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [isPlaying, isBusy, snapshot.revision, snapshot.capabilities.canStep, runAction, runtime]);

  const approve = async () => {
    const shouldResume = resumeAfterApproval.current;
    const result = await runAction(() => runtime.approve());
    if (result?.accepted && shouldResume) {
      resumeAfterApproval.current = false;
      setIsPlaying(true);
    }
  };

  const reject = async () => {
    resumeAfterApproval.current = false;
    await runAction(() => runtime.reject());
  };

  const reset = () => {
    setIsPlaying(false);
    resumeAfterApproval.current = false;
    setConfirmReset(false);
    runtime.reset();
  };

  const togglePlay = () => {
    resumeAfterApproval.current = false;
    setIsPlaying((current) => !current);
  };

  const replayDelivery = async (eventId: string) => {
    await runAction(() => runtime.replayDelivery(eventId));
  };

  const activityIcon = snapshot.lastActivity?.duplicate ? (
    <Info size={16} aria-hidden="true" />
  ) : snapshot.projection.status === "execution-failed" ? (
    <AlertTriangle size={16} aria-hidden="true" />
  ) : (
    <CheckCircle2 size={16} aria-hidden="true" />
  );

  return (
    <div className="app-shell">
      <ScenarioHeader
        snapshot={snapshot}
        isPlaying={isPlaying}
        isBusy={isBusy}
        confirmReset={confirmReset}
        onTrigger={() => void runAction(() => runtime.trigger())}
        onStep={() => void runAction(() => runtime.step())}
        onTogglePlay={togglePlay}
        onReplay={() => runtime.replayLog()}
        onRequestReset={() => setConfirmReset(true)}
        onConfirmReset={reset}
        onCancelReset={() => setConfirmReset(false)}
      />

      <main className="container">
        {snapshot.persistenceNotice ? (
          <div className="notice" role="status">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{snapshot.persistenceNotice.message}</span>
          </div>
        ) : null}

        <CloudCollaboration />
        <Overview projection={snapshot.projection} />
        <EventFabric
          envelopes={snapshot.envelopes}
          duplicateMessage={snapshot.lastActivity?.duplicate ? snapshot.lastActivity.message : null}
          onReplayDelivery={replayDelivery}
        />

        <div className="workspace">
          <div className="workspace-main">
            {snapshot.projection.status === "rejected" ? (
              <section className="terminal-state" aria-labelledby="rejected-title">
                <AlertTriangle size={27} color="var(--danger)" aria-hidden="true" />
                <h2 id="rejected-title">Plan rejected — execution blocked</h2>
                <p>
                  The durable rejection is terminal for this simulation. No reroute command can
                  be published. Reset the case to demonstrate another decision path.
                </p>
              </section>
            ) : null}
            <AgentWorkbench projection={snapshot.projection} />
          </div>
          <OperationsSidebar
            snapshot={snapshot}
            isBusy={isBusy}
            onApprove={approve}
            onReject={reject}
            onRetry={() => runAction(() => runtime.retry()).then(() => undefined)}
          />
        </div>
      </main>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {actionError ?? snapshot.lastActivity?.message ?? "Simulation ready. Trigger the vessel delay to begin."}
      </div>
      {actionError || snapshot.lastActivity ? (
        <div className="toast" role="status">
          {actionError ? <AlertTriangle size={16} aria-hidden="true" /> : activityIcon}
          <span>{actionError ?? snapshot.lastActivity?.message}</span>
        </div>
      ) : null}
    </div>
  );
}
