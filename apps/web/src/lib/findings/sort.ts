import type { Finding } from "../../data";

export type QueueSort = "Priority" | "Newest" | "SLA";

function ageHours(age: string): number {
  const normalized = age.trim().toLowerCase();
  if (normalized === "now") return 0;
  const match = /^(\d+(?:\.\d+)?)\s*([hd])$/.exec(normalized);
  if (!match) return Number.POSITIVE_INFINITY;
  const value = Number(match[1]);
  return match[2] === "d" ? value * 24 : value;
}

function priorityRank(finding: Finding): number {
  if (finding.state === "Verification failed") return 0;
  if (
    finding.state === "Awaiting verification" &&
    finding.severity === "Critical"
  )
    return 1;
  if (finding.slaBreached) return 2;
  if (
    (finding.severity === "Critical" || finding.severity === "High") &&
    (finding.state === "Needs remediation" || finding.state === "Remediating")
  ) {
    return 3;
  }
  return 4;
}

export function sortFindings(findings: Finding[], sort: QueueSort): Finding[] {
  const copy = [...findings];

  if (sort === "Newest") {
    return copy.sort((a, b) => ageHours(a.age) - ageHours(b.age));
  }

  if (sort === "SLA") {
    return copy.sort((a, b) => {
      const breachDelta =
        Number(Boolean(b.slaBreached)) - Number(Boolean(a.slaBreached));
      return (
        breachDelta ||
        priorityRank(a) - priorityRank(b) ||
        ageHours(a.age) - ageHours(b.age)
      );
    });
  }

  return copy.sort(
    (a, b) =>
      priorityRank(a) - priorityRank(b) || ageHours(a.age) - ageHours(b.age),
  );
}
