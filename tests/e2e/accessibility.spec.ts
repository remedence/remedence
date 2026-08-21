import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

const repositoryRoot = process.cwd();
const axeArtifactDirectory = join(repositoryRoot, "artifacts", "task17", "axe");

function findingRow(page: Page, findingKey: string): Locator {
  return page.getByRole("row").filter({ hasText: findingKey });
}

async function writeAxeResult(
  name: string,
  result: Awaited<ReturnType<AxeBuilder["analyze"]>>,
) {
  await mkdir(axeArtifactDirectory, { recursive: true });
  await writeFile(
    join(axeArtifactDirectory, `${name}.json`),
    JSON.stringify(result, null, 2),
    "utf8",
  );
}

async function expectNoSeriousAxeViolations(page: Page, name: string) {
  const result = await new AxeBuilder({ page }).analyze();
  await writeAxeResult(name, result);
  const violations = result.violations.filter(
    (violation) =>
      violation.impact === "serious" ||
      violation.impact === "critical" ||
      violation.id === "aria-allowed-role",
  );
  expect(
    violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

async function createAwaitingVerificationFinding(request: APIRequestContext) {
  const suffix = Date.now().toString(36).toUpperCase();
  const findingKey = `SEC-A11Y-${suffix}`;
  const imported = await request.post("/api/v1/imports", {
    data: {
      company_id: "company-juniper-ridge-dental",
      finding_key: findingKey,
      title: `Accessibility verification ${suffix}`,
      description: "Task 17 keyboard and Axe verification fixture.",
      source: "Task 17 accessibility",
      severity: "High",
      owner: "Task 17",
      asset_name: "a11y-api",
      detected_at: "2026-08-20T10:00:00.000Z",
      sla_due_at: "2026-08-27T10:00:00.000Z",
    },
  });
  expect(imported.status()).toBe(201);
  const importBody = (await imported.json()) as { finding: { id: string } };

  const remediation = await request.post("/api/v1/remediations", {
    data: {
      finding_id: importBody.finding.id,
      owner: "Task 17",
      summary: "Prepare accessibility verification state.",
      reference: `task17://a11y/${suffix}/remediation`,
    },
  });
  expect(remediation.status()).toBe(201);
  const remediationBody = (await remediation.json()) as { id: string };

  const completed = await request.post(
    `/api/v1/remediations/${remediationBody.id}/complete`,
    {
      data: {
        summary: "Ready for independent accessibility verification.",
        reference: `task17://a11y/${suffix}/complete`,
      },
    },
  );
  expect(completed.status()).toBe(200);
  return findingKey;
}

async function importFinding(
  request: APIRequestContext,
  prefix: string,
): Promise<string> {
  const suffix = Date.now().toString(36).toUpperCase();
  const findingKey = `${prefix}-${suffix}`;
  const imported = await request.post("/api/v1/imports", {
    data: {
      company_id: "company-juniper-ridge-dental",
      finding_key: findingKey,
      title: `Task 17 browser fixture ${suffix}`,
      description: "Task 17 browser regression fixture.",
      source: "Task 17 browser",
      severity: "High",
      owner: "Task 17",
      asset_name: "browser-api",
      detected_at: "2026-08-20T10:00:00.000Z",
      sla_due_at: "2026-08-27T10:00:00.000Z",
    },
  });
  expect(imported.status()).toBe(201);
  return findingKey;
}

async function importLongIdentifier(
  request: APIRequestContext,
): Promise<string> {
  const suffix = Date.now().toString(36).toUpperCase();
  const findingKey = `SEC-${"LONG".repeat(20)}-${suffix}`.slice(0, 100);
  const imported = await request.post("/api/v1/imports", {
    data: {
      company_id: "company-juniper-ridge-dental",
      finding_key: findingKey,
      title: `Long identifier viewport probe ${suffix}`,
      description: "Task 17 document-overflow regression fixture.",
      source: "Task 17 viewport",
      severity: "High",
      owner: "Task 17",
      asset_name: "viewport-api",
      detected_at: "2026-08-20T10:00:00.000Z",
      sla_due_at: "2026-08-27T10:00:00.000Z",
    },
  });
  expect(imported.status()).toBe(201);
  return findingKey;
}

async function documentOverflow(page: Page) {
  return await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    overflowing: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .map((element) => ({
        element,
        rect: element.getBoundingClientRect(),
      }))
      .filter(
        ({ rect }) =>
          rect.width > 0 &&
          (rect.right > window.innerWidth + 1 || rect.left < -1),
      )
      .slice(0, 12)
      .map(({ element, rect }) => ({
        tag: element.tagName.toLowerCase(),
        className: element.className,
        text: (element.textContent ?? "").trim().slice(0, 140),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      })),
  }));
}

test.describe("Task 17 accessibility and browser regression pre-flight", () => {
  test("skip link, primary navigation, global search, and modal focus work by keyboard", async ({
    page,
  }) => {
    await page.goto("/");

    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await page.keyboard.press("Tab");
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("#workspace-main")).toBeFocused();

    await page.reload();
    await page.keyboard.press("Tab");
    await expect(skipLink).toBeFocused();

    const primaryNames = [
      "Dashboard",
      "Companies",
      "Findings",
      "Remediation",
      "Verification",
      "Evidence",
      "Reports",
      "Integrations",
    ] as const;
    for (const name of primaryNames) {
      await page.keyboard.press("Tab");
      const target =
        name === "Verification"
          ? page.getByRole("button", { name: /^Verification \d+$/ })
          : page.getByRole("button", { name, exact: true });
      await expect(target).toBeFocused();
    }

    for (const name of ["Settings", "Help", "Account"] as const) {
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toBeFocused();
    }

    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Organization")).toBeFocused();
    await page.keyboard.press("Tab");
    const globalSearch = page.getByLabel("Global search");
    await expect(globalSearch).toBeFocused();
    await page.keyboard.type("SEC-1042");
    await expect(
      page.getByRole("region", { name: "Global search results" }),
    ).toBeVisible();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await expect(globalSearch).toHaveValue("");

    const trigger = page.getByRole("button", { name: "Import finding" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Import finding" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Company")).toBeFocused();
    await expect(page.locator(".app-shell")).toHaveAttribute("inert", "");

    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", { name: "Close import finding" }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", { name: "Import finding", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "Close import finding" }),
    ).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.locator(".app-shell")).not.toHaveAttribute("inert", "");
  });

  test("finding, remediation, verification, and report surfaces preserve keyboard focus", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const remediationKey = await importFinding(
      request,
      "SEC-FOCUS-REMEDIATION",
    );
    const verificationKey = await createAwaitingVerificationFinding(request);

    await page.goto(`/?search=${encodeURIComponent(remediationKey)}`);
    const remediationTrigger = findingRow(page, remediationKey).getByRole(
      "button",
      {
        name: "Start remediation",
      },
    );
    await remediationTrigger.focus();
    await page.keyboard.press("Enter");
    const remediation = page.getByRole("dialog", { name: "Remediation" });
    await expect(remediation).toBeVisible();
    await expect(
      remediation.getByRole("button", { name: "Close remediation" }),
    ).toBeFocused();
    await expect(page.locator(".app-shell")).toHaveAttribute("inert", "");
    await page.keyboard.press("Shift+Tab");
    await expect(
      remediation.getByRole("button", { name: "Start remediation" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(remediation).toHaveCount(0);
    await expect(remediationTrigger).toBeFocused();

    await page.goto(`/?search=${encodeURIComponent(verificationKey)}`);
    const verificationTrigger = findingRow(page, verificationKey).getByRole(
      "button",
      { name: "Review verification" },
    );
    await verificationTrigger.focus();
    await page.keyboard.press("Enter");
    const verification = page.getByRole("dialog", { name: "Verification" });
    await expect(verification).toBeVisible();
    await expect(
      verification.getByRole("button", { name: "Close verification" }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      verification.getByRole("button", { name: "Create verification" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(verification).toHaveCount(0);
    await expect(verificationTrigger).toBeFocused();

    await page.getByRole("button", { name: "Findings", exact: true }).click();
    const detailTrigger = page
      .getByRole("button", { name: "View details" })
      .first();
    await detailTrigger.focus();
    await page.keyboard.press("Enter");
    const detail = page.getByRole("dialog", { name: "Finding detail" });
    await expect(detail).toBeVisible();
    const closeDetail = detail.getByRole("button", {
      name: "Close finding detail",
    });
    await expect(closeDetail).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(closeDetail).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
    await expect(detailTrigger).toBeFocused();

    await page.getByRole("button", { name: "Reports", exact: true }).click();
    const reportTrigger = page.getByRole("button", { name: "Generate report" });
    await reportTrigger.focus();
    await page.keyboard.press("Enter");
    const report = page.getByRole("dialog", { name: "Generate report" });
    await expect(report).toBeVisible();
    await expect(report.getByLabel("Company")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      report.getByRole("button", { name: "Close generate report" }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      report.getByRole("button", { name: "Generate report", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(report).toHaveCount(0);
    await expect(reportTrigger).toBeFocused();
  });

  test("major application states have no serious or critical Axe violations", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const awaitingKey = await createAwaitingVerificationFinding(request);

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Action queue" }),
    ).toBeVisible();
    await expectNoSeriousAxeViolations(page, "dashboard-desktop");

    await page.getByRole("button", { name: "Findings", exact: true }).click();
    await page.getByRole("button", { name: "View details" }).first().click();
    const detail = page.getByRole("dialog", { name: "Finding detail" });
    await expect(detail).toBeVisible();
    await expectNoSeriousAxeViolations(page, "finding-detail");
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
    await page.getByRole("button", { name: "Dashboard", exact: true }).click();

    const remediationTrigger = page
      .getByRole("button", { name: /Start (?:new )?remediation/ })
      .first();
    await remediationTrigger.click();
    const remediation = page.getByRole("dialog", { name: "Remediation" });
    await expect(remediation).toBeVisible();
    await expectNoSeriousAxeViolations(page, "remediation-dialog");
    await page.keyboard.press("Escape");

    await page.goto(`/?search=${encodeURIComponent(awaitingKey)}`);
    const row = findingRow(page, awaitingKey);
    await expect(row).toContainText("Awaiting verification");
    await row.getByRole("button", { name: "Review verification" }).click();
    const verification = page.getByRole("dialog", { name: "Verification" });
    await expect(verification).toBeVisible();
    await expectNoSeriousAxeViolations(page, "verification-dialog");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Evidence", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Evidence" })).toBeVisible();
    await expectNoSeriousAxeViolations(page, "evidence");

    await page.getByRole("button", { name: "Reports", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
    await expectNoSeriousAxeViolations(page, "reports");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Action queue" }),
    ).toBeVisible();
    await expectNoSeriousAxeViolations(page, "dashboard-mobile-390x844");
  });

  test("required viewport matrix keeps document width bounded and actions reachable", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const findingKey = await importLongIdentifier(request);
    const viewports = [
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
      { width: 1024, height: 768 },
      { width: 430, height: 932 },
      { width: 390, height: 844 },
    ] as const;

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(`/?search=${encodeURIComponent(findingKey)}`);
      await expect(
        page.getByRole("heading", { name: "Action queue" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Import finding" }),
      ).toBeVisible();
      await expect(
        page
          .locator(".status-chip:visible")
          .filter({ hasText: "Needs remediation" })
          .first(),
      ).toContainText("Needs remediation");

      const overflow = await documentOverflow(page);
      const overflowContext = `${viewport.width}x${viewport.height}: ${JSON.stringify(overflow.overflowing)}`;
      expect(overflow.scrollWidth, overflowContext).toBe(overflow.clientWidth);
      expect(overflow.bodyScrollWidth, overflowContext).toBe(
        overflow.viewportWidth,
      );

      if (viewport.width < 900) {
        const menu = page.getByRole("button", { name: "Open navigation" });
        await expect(menu).toBeVisible();
        await menu.click();
        await expect(
          page
            .getByRole("navigation", { name: "Mobile navigation" })
            .getByRole("button", { name: "Dashboard" }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
      } else {
        await expect(
          page
            .getByRole("navigation", { name: "Primary" })
            .getByRole("button", { name: "Dashboard" }),
        ).toBeVisible();
      }

      const trigger = page.getByRole("button", { name: "Import finding" });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Import finding" });
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
      await page.keyboard.press("Escape");
    }
  });

  test("hostile-looking persisted text renders literally without script execution", async ({
    page,
    request,
  }) => {
    const suffix = Date.now().toString(36).toUpperCase();
    const findingKey = `SEC-XSS-${suffix}`;
    const hostileTitle = `<img src=x onerror="document.body.dataset.task17Xss='executed'"> & snow 雪`;
    const response = await request.post("/api/v1/imports", {
      data: {
        company_id: "company-juniper-ridge-dental",
        finding_key: findingKey,
        title: hostileTitle,
        description:
          "Quotes: \"double\" and 'single'\nSecond line & <script>literal</script>.",
        source: "Task 17 browser abuse",
        severity: "High",
        owner: "O'Neil & QA",
        asset_name: "browser雪<&>",
        detected_at: "2026-08-20T10:00:00.000Z",
        sla_due_at: "2026-08-27T10:00:00.000Z",
      },
    });
    expect(response.status()).toBe(201);

    await page.goto(`/?search=${encodeURIComponent(findingKey)}`);
    await expect(
      page.getByText(hostileTitle, { exact: true }).first(),
    ).toBeVisible();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(
      await page.evaluate(() => document.body.dataset.task17Xss ?? ""),
    ).toBe("");
  });

  test("reduced motion preserves dialog state, focus, and workflow meaning", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Import finding" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Import finding" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Company")).toBeFocused();
    const motion = await dialog.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        animationDuration: style.animationDuration,
        transitionDuration: style.transitionDuration,
      };
    });
    expect(Number.parseFloat(motion.animationDuration)).toBeLessThanOrEqual(
      0.00001,
    );
    expect(Number.parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(
      0.00001,
    );
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });
});
