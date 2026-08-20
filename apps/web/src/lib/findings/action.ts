import type { Finding } from "../../data";

export type FindingAction =
  | { kind: "finding" }
  | { kind: "verification" }
  | { kind: "page"; page: "Remediation" | "Evidence" };

export function resolveFindingAction(finding: Finding): FindingAction {
  switch (finding.state) {
    case "Verification failed":
      return { kind: "finding" };
    case "Awaiting verification":
      return { kind: "verification" };
    case "Needs remediation":
    case "Remediating":
      return { kind: "page", page: "Remediation" };
    case "Verified fixed":
      return { kind: "page", page: "Evidence" };
  }
}
