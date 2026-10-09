import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const cloudUrl = process.env.CLOUD_API_URL;
const appUrl = process.env.CLOUD_APP_URL ?? "http://127.0.0.1:4173/sap-agent-choreography/";

interface Created {
  session: { sessionId: string; joinCode: string };
  presenterToken: string;
  approverUrl: string;
  joinUrl: string;
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${cloudUrl}${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function phone(browser: Browser, url: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(url.replace("https://solacese.github.io/sap-agent-choreography/", appUrl));
  return { context, page };
}

test.skip(!cloudUrl, "Set CLOUD_API_URL to run deployed multiplayer journey");

test("expired presenter cache rotates to a new-session action", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("sap-solace-cloud-session-v1", JSON.stringify({
    session: { sessionId: "expired", joinCode: "OLD123", expiresAt: 1, status: "active", revision: 0, events: [], agentStatus: {}, agentResults: {}, roleClaims: {}, votes: {} },
    presenterToken: "expired", approverToken: "expired", joinUrl: "https://example.test", approverUrl: "https://example.test",
  })));
  await page.goto(appUrl);
  await expect(page.getByRole("button", { name: "Start multiplayer session" })).toBeVisible();
  await expect(page.getByText("OLD123")).toHaveCount(0);
});

test("invalid or expired phone link shows a recovery message", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${appUrl}?view=phone&session=expired&code=EXPIRED`);
  await expect(page.getByRole("heading", { name: "This session expired" })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText(/Ask the presenter to choose New session/i)).toBeVisible();
});

test("choices unlock only when each human-agent step is active", async ({ browser }) => {
  test.setTimeout(120_000);
  const created = await request("/sessions", { method: "POST" }) as Created;
  const roles = ["sourcing", "logistics", "customer-sla", "supervisor"] as const;
  const players: Array<{ context: BrowserContext; page: Page }> = [];

  try {
    for (const [index, role] of roles.entries()) {
      const player = await phone(browser, created.joinUrl);
      players.push(player);
      await player.page.getByLabel("Your name").fill(`Player ${index + 1}`);
      await player.page.getByRole("button", { name: new RegExp(`^${role.replace("-", "/")}`, "i") }).click();
      await expect(player.page.getByText(new RegExp(`${role.replace("-", "/")}.*claimed`, "i"))).toBeVisible({ timeout: 8_000 });
      await expect(player.page.getByRole("radiogroup")).toHaveCount(0, { timeout: 3_000 });
    }

    // The API enforces the same gate even if someone bypasses the UI.
    const stored = await players[0]!.page.evaluate(() => JSON.parse(sessionStorage.getItem("sap-solace-phone-role-v1") ?? "null"));
    const early = await fetch(`${cloudUrl}/sessions/${created.session.sessionId}/submit-decision`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-token": stored.token },
      body: JSON.stringify({ agent: "sourcing", optionId: "regional-stock" }),
    });
    expect(early.status).toBe(409);

    await request(`/sessions/${created.session.sessionId}/trigger`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-token": created.presenterToken }, body: "{}",
    });

    for (const player of players.slice(0, 3)) await expect(player.page.getByRole("radiogroup")).toBeVisible({ timeout: 8_000 });
    await expect(players[3]!.page.getByRole("radiogroup")).toHaveCount(0);
    await expect(players[3]!.page.getByText(/unlock after Sourcing, Logistics, and Customer\/SLA submit/i)).toBeVisible();

    const choices = [/Regional safety stock/i, /Divert via Zeebrugge/i, /Protect every SLA/i];
    for (let index = 0; index < 3; index += 1) {
      const page = players[index]!.page;
      await page.getByRole("radio", { name: choices[index] }).click();
      await page.getByRole("button", { name: /Submit as/i }).click();
      await expect(page.getByText(/submitted/i)).toBeVisible();
    }

    await expect(players[3]!.page.getByRole("radiogroup")).toBeVisible({ timeout: 8_000 });
    await players[3]!.page.getByRole("radio", { name: /Recommend Zeebrugge/i }).click();
    await players[3]!.page.getByRole("button", { name: /Submit as Supervisor/i }).click();

    const approver = await phone(browser, created.approverUrl);
    players.push(approver);
    await expect(approver.page.getByText("Approval required")).toBeVisible({ timeout: 8_000 });
    await approver.page.getByRole("button", { name: "Approve" }).click();
    await expect(approver.page.getByText("Approval required")).toHaveCount(0, { timeout: 8_000 });
  } finally {
    await Promise.all(players.map(({ context }) => context.close()));
  }
});
