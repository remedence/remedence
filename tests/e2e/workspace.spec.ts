import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const viewports = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "mobile-390", width: 390, height: 844 },
] as const;

for (const viewport of viewports) {
  test(`${viewport.name} keeps the dashboard usable without horizontal overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto("/");

    await expect(
      page.getByRole("heading", { level: 1, name: "Dashboard" }),
    ).toBeVisible();
    if (viewport.width < 1100) {
      await expect(page.locator(".mobile-finding-row").first()).toContainText(
        "SEC-1042",
      );
    } else {
      await expect(page.locator(".queue-table tbody tr").first()).toContainText(
        "SEC-1042",
      );
    }

    const horizontalOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
  });
}

test("keyboard entry starts with the skip link and mobile navigation is actionable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Evidence" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Evidence" }),
  ).toBeVisible();
});

test("SEC-1042 preserves failed verification history after an independent pass", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const trigger = page.getByRole("button", { name: "View finding" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Verify fix" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Verification #1 failed")).toBeVisible();

  await dialog
    .getByRole("button", { name: "Run independent verification" })
    .click();
  await expect(
    dialog.getByText("Verified fixed. Evidence bundle locked."),
  ).toBeVisible();
  await expect(dialog.getByText("Verification #1 failed")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open findings 46" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Verification failed 2" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Verified fixed 127" }),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "View evidence" }).first(),
  ).toBeFocused();
  await expect(
    page.getByText("Secondary query path remains exploitable."),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: "Verification 8", exact: true })
    .click();
  await expect(
    page.getByText("Secondary query path remains exploitable · 8 min ago"),
  ).toBeVisible();
});

test("verification drawer traps focus, inerts background, and restores its trigger", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "View finding" });
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Verify fix" });
  const close = dialog.getByRole("button", {
    name: "Close verification drawer",
  });
  const last = dialog.getByRole("button", { name: "Return to remediation" });

  await expect(page.locator(".workspace")).toHaveAttribute("inert", "");
  await expect(page.locator(".sidebar")).toHaveAttribute("inert", "");
  await expect(close).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".workspace")).not.toHaveAttribute("inert", "");
  await expect(page.locator(".sidebar")).not.toHaveAttribute("inert", "");
  await expect(trigger).toBeFocused();
});

test("import and report dialogs share the accessible dialog layer", async ({
  page,
}) => {
  await page.goto("/");

  const importTrigger = page.getByRole("button", { name: "Import findings" });
  await importTrigger.click();
  const importDialog = page.getByRole("dialog", { name: "Import findings" });
  await expect(
    importDialog.getByRole("button", { name: "Close import dialog" }),
  ).toBeFocused();
  await expect(page.locator(".workspace")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(importDialog).toHaveCount(0);
  await expect(importTrigger).toBeFocused();

  const reportTrigger = page.getByRole("button", { name: "Generate report" });
  await reportTrigger.click();
  const reportDialog = page.getByRole("dialog", {
    name: "August Security Review",
  });
  await expect(
    reportDialog.getByRole("button", { name: "Close report dialog" }),
  ).toBeFocused();
  await expect(page.locator(".workspace")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(reportDialog).toHaveCount(0);
  await expect(page.locator(".workspace")).not.toHaveAttribute("inert", "");
  await expect(reportTrigger).toBeFocused();
});

test("mobile actions, owner filtering, and queue sorting share real state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/");

  await page.getByRole("button", { name: "Start remediation" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Remediation" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Verify fix" })).toHaveCount(0);

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Dashboard" })
    .click();

  const mobileFilters = page.locator(".mobile-filter-details");
  await mobileFilters.locator("summary").click();
  await mobileFilters.getByLabel("Owner").selectOption("S. Patel");
  await expect(page.locator(".mobile-finding-row")).toHaveCount(1);
  await expect(page.locator(".mobile-finding-row").first()).toContainText(
    "SEC-1073",
  );

  await mobileFilters.getByLabel("Owner").selectOption("All owners");
  await mobileFilters.getByLabel("Sort").selectOption("Newest");
  await expect(page.locator(".mobile-finding-row").nth(0)).toContainText(
    "SEC-1042",
  );
  await expect(page.locator(".mobile-finding-row").nth(1)).toContainText(
    "SEC-1081",
  );
});

test("import form exposes a written corrective error state", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Import findings" }).click();
  const dialog = page.getByRole("dialog", { name: "Import findings" });
  await dialog.getByRole("button", { name: "Import finding" }).click();
  await expect(
    dialog.getByText("Finding ID and title are required before importing."),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("case-insensitive duplicate imports stay rejected", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Import findings" }).click();
  const dialog = page.getByRole("dialog", { name: "Import findings" });
  await dialog.getByLabel("Finding ID").fill("sec-1042");
  await dialog.getByLabel("Finding title").fill("Duplicate finding");
  await dialog.getByRole("button", { name: "Import finding" }).click();

  await expect(
    dialog.getByText(
      "SEC-1042 already exists in this workspace. Use a different finding ID.",
    ),
  ).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(
    page.locator(".queue-table tbody tr").filter({ hasText: "SEC-1042" }),
  ).toHaveCount(1);
});

test("global search works from secondary pages", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Remediation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Remediation" }),
  ).toBeVisible();

  const searchbox = page.getByRole("searchbox", { name: "Global search" });
  await searchbox.fill("semgrep");
  const results = page.getByRole("region", { name: "Global search results" });
  await expect(results).toContainText("SEC-1042");

  await page.keyboard.press("Escape");
  await expect(results).toHaveCount(0);
  await expect(searchbox).toHaveValue("semgrep");
  await page.keyboard.press("Tab");
  await searchbox.click();
  await expect(results).toContainText("SEC-1042");
  await results.getByRole("button", { name: "Open finding SEC-1042" }).click();
  await expect(page.getByRole("dialog", { name: "Verify fix" })).toBeVisible();
  await page.keyboard.press("Escape");

  await searchbox.fill("juniper");
  await results
    .getByRole("button", { name: "Open company Juniper Ridge Dental" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Companies" }),
  ).toBeVisible();
});

test("resolved verification updates active notifications", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "View finding" }).click();
  await page
    .getByRole("dialog", { name: "Verify fix" })
    .getByRole("button", { name: "Run independent verification" })
    .click();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Notifications, 1 unread" }).click();
  const notifications = page.getByRole("region", { name: "Notifications" });
  await expect(notifications).toContainText(
    "SEC-1042 verified fixed. Evidence bundle locked.",
  );
  await expect(notifications).not.toContainText("SEC-1042 verification failed");
});

test("reduced motion removes meaningful drawer animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "View finding" }).click();
  const drawer = page.locator(".verification-drawer");
  const animationDuration = await drawer.evaluate(
    (element) => getComputedStyle(element).animationDuration,
  );
  expect(Number.parseFloat(animationDuration)).toBeLessThanOrEqual(0.001);
});

test("desktop and mobile dashboard states have no serious automated accessibility violations", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  }
});

test("dashboard produces no console errors or failed application requests", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(request.url()));

  await page.goto("/");
  await page.getByRole("button", { name: "Notifications, 2 unread" }).click();
  await expect(
    page.getByRole("region", { name: "Notifications" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("region", { name: "Notifications" }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Generate report" }).click();
  await expect(
    page.getByRole("dialog", { name: "August Security Review" }),
  ).toBeVisible();

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
