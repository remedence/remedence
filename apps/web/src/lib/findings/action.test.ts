import { describe, expect, it } from "vitest";
import { resolveFindingAction } from "./action";

describe("resolveFindingAction", () => {
  it.each([
    ["Verification failed", { kind: "finding" }],
    ["Awaiting verification", { kind: "verification" }],
    ["Needs remediation", { kind: "page", page: "Remediation" }],
    ["Remediating", { kind: "page", page: "Remediation" }],
    ["Verified fixed", { kind: "page", page: "Evidence" }],
  ] as const)("maps %s consistently", (state, expected) => {
    expect(resolveFindingAction({ state })).toEqual(expected);
  });
});
