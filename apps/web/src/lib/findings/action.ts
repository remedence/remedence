import type { components } from "../api/schema";

type FindingState = components["schemas"]["FindingState"];

export type FindingAction =
  | { kind: "finding" }
  | { kind: "verification" }
  | { kind: "page"; page: "Remediation" | "Evidence" };

export function resolveFindingAction(finding: {
  state: FindingState;
}): FindingAction {
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
