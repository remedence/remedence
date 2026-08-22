import type { FindingState } from "./entities.js";
import { DomainError } from "../errors/domain-error.js";

const ALLOWED_TRANSITIONS = new Set<string>([
  "Needs remediation→Remediating",
  "Verification failed→Remediating",
  "Remediating→Awaiting verification",
  "Awaiting verification→Verification failed",
  "Awaiting verification→Verified fixed",
]);

export function assertFindingTransition(
  from: FindingState,
  to: FindingState,
): void {
  if (ALLOWED_TRANSITIONS.has(`${from}→${to}`)) return;

  throw new DomainError(
    "INVALID_FINDING_TRANSITION",
    409,
    `Finding cannot transition from ${from} to ${to}.`,
    { from, to },
  );
}
