import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function startClean(page: Page) {
  await page.goto("");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function advanceToApproval(page: Page) {
  await page.getByRole("button", { name: "Trigger vessel delay" }).click();
  for (let step = 0; step < 4; step += 1) {
    await page.getByRole("button", { name: "Step forward" }).click();
  }
  await expect(page.getByRole("heading", { name: "Human approval required" })).toBeVisible();
}

if (process.env.VITEST) {
  const { test: vitestTest } = await import("vitest");
  vitestTest.skip("Playwright scenarios run through npm run test:e2e", () => undefined);
} else {
  test.beforeEach(async ({ page }) => {
    await startClean(page);
  });

  test("persists approval, then fails safely, retries and completes", async ({ page }) => {
  await advanceToApproval(page);
  await page.reload();

  await expect(page.getByRole("heading", { name: "Human approval required" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Step forward" })).toBeDisabled();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { name: "Plan approved" })).toBeVisible();

  await page.getByRole("button", { name: "Run demo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh quote & retry" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/carrier quote expired/i).first()).toBeVisible();

  await page.getByRole("button", { name: "Refresh quote & retry" }).click();
  await page.getByRole("button", { name: "Run demo", exact: true }).click();
  await expect(page.getByText("Case completed")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/3 notifications sent/i)).toBeVisible();
});

test("rejection is terminal and never publishes a reroute command", async ({ page }) => {
  await advanceToApproval(page);
  await page.getByRole("button", { name: "Reject" }).click();

  await expect(page.getByRole("heading", { name: "Plan rejected — execution blocked" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /logistics\.reroute\.requested\.v1/i }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run demo", exact: true })).toBeDisabled();
});

test("duplicate delivery and log replay do not create new envelopes", async ({ page }) => {
  await page.getByRole("button", { name: "Trigger vessel delay" }).click();
  await page.getByRole("button", { name: /shipment\.delay\.detected\.v1/i }).click();
  await page.getByRole("button", { name: /Replay delivery with same ID/i }).click();

  await expect(page.getByText("Duplicate ignored")).toBeVisible();
  await page.getByRole("button", { name: "Close event details" }).click();
  await expect(page.getByText("1 envelope · append only")).toBeVisible();

  await page.getByRole("button", { name: "Replay log" }).click();
  await expect(page.getByText("1 envelope · append only")).toBeVisible();
  await expect(page.getByRole("status").getByText(/Replayed 1 envelopes to rebuild/i)).toBeVisible();
});

test("mobile layout has no page overflow and no serious accessibility violations", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();

  await expect(page.getByRole("heading", { name: "MV Horizon disruption control tower" })).toBeVisible();
  await page.getByRole("button", { name: "Trigger vessel delay" }).click();
  await page.getByRole("button", { name: "Step forward" }).click();
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  });
}
