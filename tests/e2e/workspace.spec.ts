import { expect, test, type Locator, type Page } from "@playwright/test";

function findingRow(page: Page, findingKey: string): Locator {
  return page.getByRole("row").filter({ hasText: findingKey });
}

async function metric(page: Page, label: string): Promise<number> {
  const button = page.getByRole("button", {
    name: new RegExp(`^${label} \\d+$`),
  });
  const ariaLabel = await button.getAttribute("aria-label");
  const match = ariaLabel?.match(/(\d+)$/);
  if (!match)
    throw new Error(
      `Could not read ${label} metric from ${ariaLabel ?? "missing aria-label"}`,
    );
  return Number(match[1]);
}

async function fillImport(
  page: Page,
  findingKey: string,
  title: string,
): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Import finding" });
  await dialog
    .getByLabel("Company")
    .selectOption({ label: "Juniper Ridge Dental" });
  await dialog.getByLabel("Severity").selectOption("Critical");
  await dialog.getByLabel("Source").fill("Task 15 Playwright");
  await dialog.getByLabel("Finding key").fill(findingKey);
  await dialog.getByLabel("Title").fill(title);
  await dialog
    .getByLabel("Description")
    .fill("Persistent mutation workflow exercised by Playwright.");
  await dialog.getByLabel("Owner").fill("A. Rivera");
  await dialog.getByLabel("Asset").fill("task15-e2e-api");
  await dialog.getByLabel("Detected at").fill("2026-08-20T20:00");
  await dialog.getByLabel("SLA due at").fill("2026-08-27T20:00");
}

test.describe("Task 15 persistent mutation workflows", () => {
  test("persists import, failed verification, second remediation, verified closure, evidence, and report snapshot", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const suffix = Date.now().toString(36).toUpperCase();
    const findingKey = `SEC-E2E-${suffix}`;
    const title = `Task 15 E2E ${suffix}`;
    const evidenceLabel = `Authorization regression proof ${suffix}`;
    const reportPeriod = `Task 15 E2E ${suffix}`;

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Action queue" }),
    ).toBeVisible();

    const initialOpen = await metric(page, "Open findings");
    const initialFailed = await metric(page, "Verification failed");
    const initialVerified = await metric(page, "Verified fixed");

    await page.getByRole("button", { name: "Import finding" }).click();
    const importDialog = page.getByRole("dialog", { name: "Import finding" });
    await expect(importDialog.getByLabel("Company")).toBeFocused();
    await fillImport(page, findingKey, title);
    await importDialog
      .getByRole("button", { name: "Import finding", exact: true })
      .click();

    await expect(page.getByText(`Imported ${findingKey}.`)).toBeVisible();
    await expect(findingRow(page, findingKey)).toContainText(
      "Needs remediation",
    );
    await expect(
      page.getByRole("button", { name: `Open findings ${initialOpen + 1}` }),
    ).toBeVisible();

    await page.reload();
    await expect(findingRow(page, findingKey)).toContainText(
      "Needs remediation",
    );

    await findingRow(page, findingKey)
      .getByRole("button", { name: "Start remediation" })
      .click();
    let remediation = page.getByRole("dialog", { name: "Remediation" });
    await remediation
      .getByLabel("Remediation summary")
      .fill("Apply the first authorization fix.");
    await remediation
      .getByLabel("Remediation reference")
      .fill(`PR-${suffix}-A`);
    await remediation
      .getByRole("button", { name: "Start remediation" })
      .click();
    await expect(remediation.getByText("In progress")).toBeVisible();
    await expect(remediation.getByText(`PR-${suffix}-A`)).toBeVisible();
    await expect(findingRow(page, findingKey)).toContainText("Remediating");

    await remediation
      .getByLabel("Completion summary")
      .fill("Merged the first authorization fix.");
    await remediation
      .getByLabel("Completion reference")
      .fill(`commit-${suffix.toLowerCase()}-a`);
    await remediation
      .getByRole("button", { name: "Complete remediation" })
      .click();
    await expect(
      remediation.getByText("Awaiting independent verification."),
    ).toBeVisible();
    await expect(
      remediation.getByText(/not yet verified fixed/i),
    ).toBeVisible();
    await expect(findingRow(page, findingKey)).toContainText(
      "Awaiting verification",
    );
    await remediation
      .getByRole("button", { name: "Close remediation" })
      .click();

    await findingRow(page, findingKey)
      .getByRole("button", { name: "Review verification" })
      .click();
    let verification = page.getByRole("dialog", { name: "Verification" });
    await expect(
      verification.getByText("Record independent verification result"),
    ).toBeVisible();
    await verification
      .getByLabel("Verification method")
      .fill("Playwright regression");
    await verification.getByLabel("Verifier").fill("Independent verifier A");
    await verification
      .getByLabel("Verification scope")
      .fill("Authorization boundary");
    await verification
      .getByLabel("Expected checks")
      .fill("Authorization regression");
    await verification
      .getByRole("button", { name: "Create verification" })
      .click();

    const desktopViewport = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 844 });
    const verificationColumns = await verification
      .locator(".verification-details")
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns);
    expect(verificationColumns.trim().split(/\s+/)).toHaveLength(1);
    if (desktopViewport) await page.setViewportSize(desktopViewport);

    await verification
      .getByLabel("Result for Authorization regression")
      .selectOption("Failed");
    await verification
      .getByLabel("Message for Authorization regression")
      .fill("Secondary authorization path remains exploitable.");
    await verification
      .getByRole("button", { name: "Record Authorization regression" })
      .click();
    await expect(
      verification
        .getByText("Secondary authorization path remains exploitable.")
        .first(),
    ).toBeVisible();

    await verification
      .getByLabel("Verification result summary")
      .fill("First remediation is incomplete.");
    await verification
      .getByRole("button", { name: "Complete failed verification" })
      .click();
    await expect(
      verification.getByText("Verification failed", { exact: true }),
    ).toBeVisible();
    await expect(
      verification.getByRole("button", {
        name: "Record Authorization regression",
      }),
    ).toHaveCount(0);
    await verification
      .getByRole("button", { name: "Close verification" })
      .click();

    await expect(findingRow(page, findingKey)).toContainText(
      "Verification failed",
    );
    await expect(
      page.getByRole("button", {
        name: `Verification failed ${initialFailed + 1}`,
      }),
    ).toBeVisible();
    await page.reload();
    await expect(findingRow(page, findingKey)).toContainText(
      "Verification failed",
    );

    await findingRow(page, findingKey)
      .getByRole("button", { name: "Start new remediation" })
      .click();
    remediation = page.getByRole("dialog", { name: "Remediation" });
    await remediation
      .getByLabel("Remediation summary")
      .fill("Close the remaining secondary authorization path.");
    await remediation
      .getByLabel("Remediation reference")
      .fill(`PR-${suffix}-B`);
    await remediation
      .getByRole("button", { name: "Start remediation" })
      .click();
    await remediation
      .getByLabel("Completion summary")
      .fill("Merged the secondary authorization path fix.");
    await remediation
      .getByLabel("Completion reference")
      .fill(`commit-${suffix.toLowerCase()}-b`);
    await remediation
      .getByRole("button", { name: "Complete remediation" })
      .click();
    await expect(findingRow(page, findingKey)).toContainText(
      "Awaiting verification",
    );
    await remediation
      .getByRole("button", { name: "Close remediation" })
      .click();

    await findingRow(page, findingKey)
      .getByRole("button", { name: "Review verification" })
      .click();
    verification = page.getByRole("dialog", { name: "Verification" });
    await expect(
      verification.getByText("First remediation is incomplete."),
    ).toBeVisible();
    await expect(
      verification.getByText(
        "Secondary authorization path remains exploitable.",
      ),
    ).toBeVisible();
    await verification
      .getByLabel("Verification method")
      .fill("Playwright regression");
    await verification.getByLabel("Verifier").fill("Independent verifier B");
    await verification
      .getByLabel("Verification scope")
      .fill("Authorization boundary after remediation two");
    await verification
      .getByLabel("Expected checks")
      .fill("Authorization regression");
    await verification
      .getByRole("button", { name: "Create verification" })
      .click();
    await verification
      .getByLabel("Result for Authorization regression")
      .selectOption("Passed");
    await verification
      .getByLabel("Message for Authorization regression")
      .fill("Regression no longer reproduces.");
    await verification
      .getByRole("button", { name: "Record Authorization regression" })
      .click();

    await verification
      .getByLabel("Verification result summary")
      .fill("All independent regression checks passed.");
    await verification.getByLabel("Evidence kind").fill("regression-output");
    await verification.getByLabel("Evidence label").fill(evidenceLabel);
    await verification
      .getByLabel("Evidence source reference")
      .fill(`artifact://task15/e2e/${suffix}`);
    await verification
      .getByRole("button", { name: "Complete passed verification" })
      .click();

    await expect(
      verification.getByText("Verified fixed. Evidence bundle locked."),
    ).toBeVisible();
    await expect(
      verification.getByText("First remediation is incomplete."),
    ).toBeVisible();
    await verification
      .getByRole("button", { name: "Close verification" })
      .click();

    await expect(
      page.getByRole("button", { name: `Open findings ${initialOpen}` }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: `Verification failed ${initialFailed}`,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: `Verified fixed ${initialVerified + 1}`,
      }),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("button", {
        name: `Verified fixed ${initialVerified + 1}`,
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Evidence" }).click();
    const evidenceCard = page
      .locator(".evidence-proof-card")
      .filter({ hasText: evidenceLabel });
    await expect(evidenceCard).toBeVisible();
    await expect(evidenceCard).toContainText("Locked evidence");
    await expect(evidenceCard).toContainText("Evidence ID");
    await expect(evidenceCard).toContainText("Verification ID");
    await expect(evidenceCard).toContainText(`artifact://task15/e2e/${suffix}`);
    await expect(evidenceCard).toContainText("Content hash");
    await expect(evidenceCard).toContainText("Created");
    await expect(evidenceCard).toContainText("Locked at");

    await page.getByRole("button", { name: "Reports" }).click();
    const oldDownload = page.getByRole("link", { name: "Download Markdown" });
    const oldHref = await oldDownload.getAttribute("href");
    expect(oldHref).toBeTruthy();
    const oldReportPath = oldHref!.replace(/\/download$/, "");
    const oldBeforeResponse = await page.request.get(oldReportPath);
    expect(oldBeforeResponse.ok()).toBeTruthy();
    const oldBefore = await oldBeforeResponse.json();

    await page.getByRole("button", { name: "Generate report" }).click();
    const reportDialog = page.getByRole("dialog", { name: "Generate report" });
    await expect(reportDialog.getByLabel("Company")).toBeFocused();
    await reportDialog
      .getByLabel("Company")
      .selectOption({ label: "Juniper Ridge Dental" });
    await reportDialog.getByLabel("Period label").fill(reportPeriod);
    await reportDialog
      .getByRole("button", { name: "Generate report", exact: true })
      .click();

    await expect(
      page.getByRole("heading", { name: new RegExp(reportPeriod) }),
    ).toBeVisible();
    const newDownload = page.getByRole("link", { name: "Download Markdown" });
    const newHref = await newDownload.getAttribute("href");
    expect(newHref).toBeTruthy();
    expect(newHref).not.toBe(oldHref);
    const downloadResponse = await page.request.get(newHref!);
    expect(downloadResponse.status()).toBe(200);
    expect(downloadResponse.headers()["content-type"]).toContain(
      "text/markdown",
    );

    const oldAfterResponse = await page.request.get(oldReportPath);
    expect(oldAfterResponse.ok()).toBeTruthy();
    expect(await oldAfterResponse.json()).toEqual(oldBefore);
  });

  test("pending import cannot be dismissed after the server has committed it", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    const suffix = Date.now().toString(36).toUpperCase();
    const findingKey = `SEC-PENDING-${suffix}`;
    let markCommitted!: () => void;
    let releaseResponse!: () => void;
    const committed = new Promise<void>((resolve) => {
      markCommitted = resolve;
    });
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });

    await page.route("**/api/v1/imports", async (route) => {
      const response = await route.fetch();
      markCommitted();
      await responseGate;
      await route.fulfill({ response });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Import finding" }).click();
    const dialog = page.getByRole("dialog", { name: "Import finding" });
    await fillImport(page, findingKey, `Pending import ${suffix}`);
    await dialog
      .getByRole("button", { name: "Import finding", exact: true })
      .click();
    await committed;
    await expect(dialog.getByText("Importing finding…")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();

    releaseResponse();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(`Imported ${findingKey}.`)).toBeVisible();
    await expect(findingRow(page, findingKey)).toContainText(
      "Needs remediation",
    );
  });

  test("duplicate verification-check submit cannot re-enable dismissal while the committed request is pending", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    const suffix = Date.now().toString(36).toUpperCase();
    const checkName = `Task 18 pending check ${suffix}`;
    let markCommitted!: () => void;
    let releaseResponse!: () => void;
    const committed = new Promise<void>((resolve) => {
      markCommitted = resolve;
    });
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });

    await page.goto("/?search=SEC-1067");
    await page
      .getByRole("button", { name: "Review verification" })
      .first()
      .click();
    const verification = page.getByRole("dialog", { name: "Verification" });
    await verification
      .getByLabel("Verification method")
      .fill("Task 18 duplicate-submit regression");
    await verification.getByLabel("Verifier").fill("Independent verifier");
    await verification
      .getByLabel("Verification scope")
      .fill("Pending mutation dismissal boundary");
    await verification.getByLabel("Expected checks").fill(checkName);
    await verification
      .getByRole("button", { name: "Create verification" })
      .click();

    await page.route("**/api/v1/verifications/*/checks", async (route) => {
      const response = await route.fetch();
      markCommitted();
      await responseGate;
      await route.fulfill({ response });
    });

    const checkForm = verification.locator(".verification-check-form");
    await checkForm
      .getByLabel(`Result for ${checkName}`)
      .selectOption("Passed");
    await checkForm.getByLabel(`Message for ${checkName}`).fill("Passed");

    try {
      await checkForm.evaluate((form) => {
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      });
      await committed;
      const closeVerification = verification.getByRole("button", {
        name: "Close verification",
      });
      await expect(closeVerification).toBeDisabled();

      await page.keyboard.press("Escape");
      await expect(verification).toBeVisible();
      await expect(closeVerification).toBeDisabled();
    } finally {
      releaseResponse();
    }

    await expect(
      verification.getByText("Recording verification check."),
    ).toHaveCount(0);
    await expect(
      verification.getByRole("button", { name: `Record ${checkName}` }),
    ).toHaveCount(0);
    await expect(
      verification.getByRole("button", { name: "Close verification" }),
    ).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(verification).toHaveCount(0);
  });

  test("duplicate import preserves values, keeps URL filters, restores focus, and fits a narrow viewport", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    const suffix = Date.now().toString(36).toUpperCase();
    const findingKey = `SEC-DUP-${suffix}`;
    const title = `Duplicate browser test ${suffix}`;

    await page.goto("/");
    await page.getByLabel("Search findings").fill("Juniper");
    await expect(page).toHaveURL(/search=Juniper/);
    const filteredUrl = page.url();

    const trigger = page.getByRole("button", { name: "Import finding" });
    await trigger.click();
    await fillImport(page, findingKey, title);
    const dialog = page.getByRole("dialog", { name: "Import finding" });
    await dialog
      .getByRole("button", { name: "Import finding", exact: true })
      .click();
    await expect(page).toHaveURL(filteredUrl);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await fillImport(page, findingKey, title);
    await dialog
      .getByRole("button", { name: "Import finding", exact: true })
      .click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Conflict", { exact: true })).toBeVisible();
    await expect(
      dialog.getByText(/already exists in this organization/i),
    ).toBeVisible();
    await expect(dialog.getByText(/Request ID:/)).toBeVisible();
    await expect(dialog.getByLabel("Finding key")).toHaveValue(findingKey);
    await expect(dialog.getByLabel("Title")).toHaveValue(title);
    await expect(page).toHaveURL(filteredUrl);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });
});
