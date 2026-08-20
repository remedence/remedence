import { describe, expect, it } from "vitest";
import type { Finding } from "../../data";
import { resolveFindingAction } from "./action";

const base: Finding = {
  id: "SEC-2000",
  company: "Juniper Ridge Dental",
  title: "Example",
  severity: "High",
  state: "Needs remediation",
  owner: "M. Ortiz",
  age: "1h",
  source: "Manual",
  action: "Start remediation",
};

describe("resolveFindingAction", () => {
  it.each([
    ["Verification failed", { kind: "finding" }],
    ["Awaiting verification", { kind: "verification" }],
    ["Needs remediation", { kind: "page", page: "Remediation" }],
    ["Remediating", { kind: "page", page: "Remediation" }],
    ["Verified fixed", { kind: "page", page: "Evidence" }],
  ] as const)("maps %s consistently", (state, expected) => {
    expect(resolveFindingAction({ ...base, state })).toEqual(expected);
  });
});
