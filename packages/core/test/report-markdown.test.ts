import type { Report } from "../src/domain/entities.js";
import { describe, expect, it } from "vitest";
import { renderReportMarkdown } from "../src/report-markdown.js";

function reportFixture(): Report {
  return {
    id: "report-1",
    companyId: "company-1",
    title: "Juniper Ridge Dental - August Security Review",
    periodLabel: "August",
    status: "Ready",
    snapshot: {
      companyName: "Juniper Ridge Dental",
      riskScore: 82,
      criticalFindings: 1,
      highFindings: 2,
      verifiedFixes: 3,
      slaCompliancePercent: 96.5,
      findings: [
        {
          id: "finding-1",
          organizationId: "org-harborline",
          companyId: "company-1",
          findingKey: "SEC-1042",
          title:
            "SQL injection | secondary\nquery <script>alert(1)</script> path",
          description: "Persistent description.",
          source: "Manual",
          severity: "Critical",
          state: "Verification failed",
          owner: "S. Patel | AppSec",
          assetName: "Patient\r\nPortal API",
          detectedAt: "2026-08-10T00:00:00.000Z",
          slaDueAt: "2026-08-20T00:00:00.000Z",
          createdAt: "2026-08-10T00:00:00.000Z",
          updatedAt: "2026-08-20T00:00:00.000Z",
        },
      ],
      verificationHistory: [
        {
          id: "verification-1",
          findingId: "finding-1",
          remediationId: "remediation-1",
          status: "Failed",
          method: "Independent | retest",
          workerName: "local-verifier",
          scope: "Primary\nsecondary paths",
          resultSummary: "Secondary | path\nstill vulnerable",
          startedAt: "2026-08-19T09:00:00.000Z",
          completedAt: "2026-08-19T09:05:00.000Z",
          createdAt: "2026-08-19T09:00:00.000Z",
          checks: [
            {
              id: "check-1",
              verificationId: "verification-1",
              sequence: 1,
              name: "Secondary | query path",
              status: "Failed",
              message: "Still vulnerable\nthrough equivalent path",
              createdAt: "2026-08-19T09:01:00.000Z",
            },
          ],
        },
      ],
    },
    generatedAt: "2026-08-20T12:00:00.000Z",
    createdAt: "2026-08-20T12:00:00.000Z",
  };
}

describe("report Markdown rendering", () => {
  it("renders deterministic stored report data including failed verification history", () => {
    const report = reportFixture();
    const before = structuredClone(report);

    const markdown = renderReportMarkdown(report);

    expect(markdown).toContain(
      "# Juniper Ridge Dental - August Security Review",
    );
    expect(markdown).toContain("Period: August");
    expect(markdown).toContain("Risk score: 82");
    expect(markdown).toContain("Verified fixes: 3");
    expect(markdown).toContain("## Failed verification history");
    expect(markdown).toContain("Generated: 2026-08-20T12:00:00.000Z");
    expect(markdown).toContain(
      "SQL injection \\| secondary\\nquery \\<script\\>alert(1)\\</script\\> path",
    );
    expect(markdown).not.toContain("<script>");
    expect(markdown).not.toContain("</script>");
    expect(markdown).toContain("S. Patel \\| AppSec");
    expect(markdown).toContain("Patient\\nPortal API");
    expect(markdown).toContain("Secondary \\| path\\nstill vulnerable");
    expect(markdown).not.toContain("<br>");
    expect(report).toEqual(before);
    expect(renderReportMarkdown(report)).toBe(markdown);
  });

  it("renders an explicit empty failed-verification state", () => {
    const report = reportFixture();
    report.snapshot.verificationHistory = [];

    expect(renderReportMarkdown(report)).toContain(
      "No failed verification history is recorded in this snapshot.",
    );
  });
});
