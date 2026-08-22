import { describe, expect, it } from "vitest";
import type { Finding } from "../src/domain/entities.js";
import {
  compareFindingPriority,
  findingPriorityBucket,
  type PriorityFinding,
} from "../src/domain/priority.js";

const base: Finding = {
  id: "finding-base",
  organizationId: "org-harborline",
  companyId: "company-juniper",
  findingKey: "SEC-2000",
  title: "Example finding",
  description: "Example",
  source: "Manual",
  severity: "Medium",
  state: "Needs remediation",
  owner: "L. Chen",
  assetName: "Patient Portal API",
  detectedAt: "2026-08-20T08:00:00.000Z",
  slaDueAt: "2026-08-22T08:00:00.000Z",
  createdAt: "2026-08-20T08:00:00.000Z",
  updatedAt: "2026-08-20T08:00:00.000Z",
};

function finding(
  id: string,
  overrides: Partial<Finding> & Pick<PriorityFinding, "slaBreached">,
): PriorityFinding {
  return {
    ...base,
    ...overrides,
    id,
    findingKey: overrides.findingKey ?? id,
  };
}

describe("finding priority", () => {
  it("orders the six approved priority buckets", () => {
    const items = [
      finding("SEC-2006", { state: "Verified fixed", slaBreached: false }),
      finding("SEC-2005", { state: "Remediating", slaBreached: false }),
      finding("SEC-2004", {
        state: "Needs remediation",
        severity: "High",
        slaBreached: false,
      }),
      finding("SEC-2003", { state: "Remediating", slaBreached: true }),
      finding("SEC-2002", {
        state: "Awaiting verification",
        severity: "Critical",
        slaBreached: false,
      }),
      finding("SEC-2001", {
        state: "Verification failed",
        slaBreached: true,
      }),
    ];

    expect(items.sort(compareFindingPriority).map((item) => item.id)).toEqual([
      "SEC-2001",
      "SEC-2002",
      "SEC-2003",
      "SEC-2004",
      "SEC-2005",
      "SEC-2006",
    ]);
    expect(items.map(findingPriorityBucket)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("treats critical remediation work like high remediation work", () => {
    expect(
      findingPriorityBucket(
        finding("SEC-2100", {
          state: "Needs remediation",
          severity: "Critical",
          slaBreached: false,
        }),
      ),
    ).toBe(4);
  });

  it("breaks ties by SLA due time, detected time, then finding key", () => {
    const items = [
      finding("SEC-3004", {
        findingKey: "SEC-3004",
        slaBreached: false,
        slaDueAt: "2026-08-23T08:00:00.000Z",
        detectedAt: "2026-08-19T08:00:00.000Z",
      }),
      finding("SEC-3003", {
        findingKey: "SEC-3003",
        slaBreached: false,
        slaDueAt: "2026-08-22T08:00:00.000Z",
        detectedAt: "2026-08-20T08:00:00.000Z",
      }),
      finding("SEC-3002", {
        findingKey: "SEC-3002",
        slaBreached: false,
        slaDueAt: "2026-08-22T08:00:00.000Z",
        detectedAt: "2026-08-19T08:00:00.000Z",
      }),
      finding("SEC-3001", {
        findingKey: "SEC-3001",
        slaBreached: false,
        slaDueAt: "2026-08-22T08:00:00.000Z",
        detectedAt: "2026-08-19T08:00:00.000Z",
      }),
    ];

    expect(
      items.sort(compareFindingPriority).map((item) => item.findingKey),
    ).toEqual(["SEC-3001", "SEC-3002", "SEC-3003", "SEC-3004"]);
  });
});
