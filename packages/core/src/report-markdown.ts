import type { Report } from "./domain/entities.js";

function inlineText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replace(/\r\n?|\n/g, " ")
    .replace(/[<>]/g, (character) => `\\${character}`);
}

function tableCell(value: string | number): string {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replace(/\r\n?|\n/g, "\\n")
    .replaceAll("|", "\\|")
    .replace(/[<>]/g, (character) => `\\${character}`);
}

export function renderReportMarkdown(report: Report): string {
  const failedVerifications = report.snapshot.verificationHistory.filter(
    (verification) => verification.status === "Failed",
  );
  const findingKeys = new Map(
    report.snapshot.findings.map((finding) => [finding.id, finding.findingKey]),
  );

  const lines = [
    `# ${inlineText(report.title)}`,
    "",
    `Period: ${inlineText(report.periodLabel)}`,
    `Generated: ${inlineText(report.generatedAt)}`,
    "",
    "## Summary",
    "",
    `- Risk score: ${report.snapshot.riskScore}`,
    `- Critical findings: ${report.snapshot.criticalFindings}`,
    `- High findings: ${report.snapshot.highFindings}`,
    `- Verified fixes: ${report.snapshot.verifiedFixes}`,
    `- SLA compliance: ${report.snapshot.slaCompliancePercent}%`,
    "",
    "## Findings",
    "",
    "| Finding | Title | Severity | State | Owner | Asset |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.snapshot.findings.map(
      (finding) =>
        `| ${tableCell(finding.findingKey)} | ${tableCell(finding.title)} | ${tableCell(finding.severity)} | ${tableCell(finding.state)} | ${tableCell(finding.owner)} | ${tableCell(finding.assetName)} |`,
    ),
    "",
    "## Failed verification history",
    "",
  ];

  if (failedVerifications.length === 0) {
    lines.push("No failed verification history is recorded in this snapshot.");
  } else {
    lines.push(
      "| Finding | Verification | Method | Result | Completed |",
      "| --- | --- | --- | --- | --- |",
      ...failedVerifications.map(
        (verification) =>
          `| ${tableCell(findingKeys.get(verification.findingId) ?? verification.findingId)} | ${tableCell(verification.id)} | ${tableCell(verification.method)} | ${tableCell(verification.resultSummary)} | ${tableCell(verification.completedAt ?? "Not completed")} |`,
      ),
      "",
      "### Failed checks",
      "",
      "| Finding | Verification | Check | Message |",
      "| --- | --- | --- | --- |",
      ...failedVerifications.flatMap((verification) =>
        verification.checks
          .filter((check) => check.status === "Failed")
          .map(
            (check) =>
              `| ${tableCell(findingKeys.get(verification.findingId) ?? verification.findingId)} | ${tableCell(verification.id)} | ${tableCell(check.name)} | ${tableCell(check.message)} |`,
          ),
      ),
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
