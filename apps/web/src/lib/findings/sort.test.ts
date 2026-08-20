import { describe, expect, it } from "vitest";
import { findings } from "../../data";
import { sortFindings } from "./sort";

describe("sortFindings", () => {
  it("sorts newest by parsed age without mutating input", () => {
    const original = findings.map((finding) => finding.id);

    expect(
      sortFindings(findings, "Newest").map((finding) => finding.id),
    ).toEqual(["SEC-1042", "SEC-1081", "SEC-1067", "SEC-1058", "SEC-1073"]);
    expect(findings.map((finding) => finding.id)).toEqual(original);
  });

  it("puts breached SLA findings first for SLA sort", () => {
    expect(sortFindings(findings, "SLA")[0]?.id).toBe("SEC-1058");
  });

  it("keeps failed verification first for priority sort", () => {
    expect(sortFindings(findings, "Priority")[0]?.id).toBe("SEC-1042");
  });
});
