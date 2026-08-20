import type { Finding } from "./entities.js";

export interface PriorityFinding extends Finding {
  slaBreached: boolean;
}

export function findingPriorityBucket(finding: PriorityFinding): number {
  if (finding.state === "Verification failed") return 1;
  if (
    finding.state === "Awaiting verification" &&
    finding.severity === "Critical"
  ) {
    return 2;
  }
  if (finding.state === "Verified fixed") return 6;
  if (finding.slaBreached) return 3;
  if (
    (finding.severity === "Critical" || finding.severity === "High") &&
    (finding.state === "Needs remediation" || finding.state === "Remediating")
  ) {
    return 4;
  }
  return 5;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function compareFindingPriority(
  left: PriorityFinding,
  right: PriorityFinding,
): number {
  return (
    findingPriorityBucket(left) - findingPriorityBucket(right) ||
    compareText(left.slaDueAt, right.slaDueAt) ||
    compareText(left.detectedAt, right.detectedAt) ||
    compareText(left.findingKey, right.findingKey)
  );
}
