import { describe, expect, it } from "vitest";
import { assertFindingTransition } from "../src/domain/finding-state.js";
import { DomainError } from "../src/errors/domain-error.js";

const allowed = [
  ["Needs remediation", "Remediating"],
  ["Verification failed", "Remediating"],
  ["Remediating", "Awaiting verification"],
  ["Awaiting verification", "Verification failed"],
  ["Awaiting verification", "Verified fixed"],
] as const;

const rejected = [
  ["Needs remediation", "Verified fixed"],
  ["Remediating", "Verified fixed"],
  ["Verified fixed", "Remediating"],
] as const;

describe("assertFindingTransition", () => {
  it.each(allowed)("allows %s → %s", (from, to) => {
    expect(() => assertFindingTransition(from, to)).not.toThrow();
  });

  it.each(rejected)("rejects %s → %s", (from, to) => {
    expect.assertions(3);
    try {
      assertFindingTransition(from, to);
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("INVALID_FINDING_TRANSITION");
      expect((error as DomainError).status).toBe(409);
    }
  });
});
