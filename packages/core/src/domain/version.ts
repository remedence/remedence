import { DomainError } from "../errors/domain-error.js";

export function assertExpectedVersion(
  actualVersion: number,
  expectedVersion: number | undefined,
): void {
  if (expectedVersion === undefined || actualVersion === expectedVersion)
    return;
  throw new DomainError(
    "STALE_ENTITY_VERSION",
    412,
    "The resource changed after it was read. Reload it and retry the mutation.",
    { actualVersion, expectedVersion },
  );
}
