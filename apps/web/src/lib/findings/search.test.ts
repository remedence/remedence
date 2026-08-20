import { describe, expect, it } from "vitest";
import { companyRisk, findings } from "../../data";
import { normalizeFindingKey, searchWorkspace } from "./search";

describe("normalizeFindingKey", () => {
  it("trims and normalizes finding IDs for case-insensitive uniqueness", () => {
    expect(normalizeFindingKey("  sec-1042  ")).toBe("SEC-1042");
  });
});

describe("searchWorkspace", () => {
  it.each(["sec-1042", "juniper", "semgrep", "L. Chen"])(
    "finds SEC-1042 by %s",
    (query) => {
      expect(searchWorkspace(query, findings, companyRisk)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "finding", id: "SEC-1042" }),
        ]),
      );
    },
  );

  it("includes a company result for a matching company name", () => {
    expect(searchWorkspace("juniper", findings, companyRisk)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "company",
          id: "Juniper Ridge Dental",
          primary: "Juniper Ridge Dental",
        }),
      ]),
    );
  });

  it("returns no results for a blank query", () => {
    expect(searchWorkspace("   ", findings, companyRisk)).toEqual([]);
  });
});
