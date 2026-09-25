import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ScenarioRuntime } from "./application/scenarioRuntime";
import App from "./App";
import type { CaseRecord, CaseRepository, RepositoryNotice } from "./ports/CaseRepository";

class TestRepository implements CaseRepository {
  record: CaseRecord | null = null;

  load(): CaseRecord | null {
    return this.record;
  }

  save(record: CaseRecord): void {
    this.record = record;
  }

  clear(): void {
    this.record = null;
  }

  getNotice(): RepositoryNotice | null {
    return null;
  }
}

const runtimes: ScenarioRuntime[] = [];

const renderApp = () => {
  const runtime = new ScenarioRuntime({ repository: new TestRepository() });
  runtimes.push(runtime);
  return { runtime, ...render(<App runtime={runtime} />) };
};

const advanceToApproval = async (runtime: ScenarioRuntime) => {
  await runtime.trigger();
  while (runtime.getSnapshot().capabilities.canStep) await runtime.step();
};

afterEach(() => {
  cleanup();
  for (const runtime of runtimes.splice(0)) runtime.dispose();
});

describe("operations console", () => {
  it("drives the approval and retry path through runtime capabilities", async () => {
    const user = userEvent.setup();
    const { runtime } = renderApp();

    expect(screen.getByText(/SIMULATED — NO LIVE SAP OR AEM CONNECTION/i)).toBeVisible();
    await advanceToApproval(runtime);

    expect(await screen.findByRole("heading", { name: "Human approval required" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Step forward" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("heading", { name: "Plan approved" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Step forward" }));
    await user.click(screen.getByRole("button", { name: "Step forward" }));
    expect(await screen.findByRole("button", { name: /Refresh quote & retry/i })).toBeVisible();
  });

  it("opens event details, replays a duplicate, and restores focus", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("button", { name: "Trigger vessel delay" }));
    const envelopeButton = await screen.findByRole("button", {
      name: /shipment\.delay\.detected\.v1/i,
    });
    await user.click(envelopeButton);

    const dialog = screen.getByRole("dialog", { name: "shipment.delay.detected.v1" });
    expect(within(dialog).getByText("corr-mv-horizon-2026-0042")).toBeVisible();
    expect(within(dialog).getByText(/"vesselName": "MV Horizon"/)).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: /Replay delivery/i }));
    expect(await screen.findByText("Duplicate ignored")).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: "Close event details" }));
    await waitFor(() => expect(envelopeButton).toHaveFocus());
  });

  it("requires inline confirmation before resetting", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("button", { name: "Trigger vessel delay" }));
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("button", { name: "Confirm reset" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Reset" })).toBeVisible();
  });
});
