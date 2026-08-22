import { describe, expect, it } from "vitest";
import { hashEvidenceMetadata } from "../src/index.js";

function evidence(metadata: Record<string, unknown>) {
  return {
    kind: "verification-result",
    label: "Independent retest",
    sourceReference: "verification://verification-2",
    metadata,
  };
}

describe("hashEvidenceMetadata", () => {
  it("produces the same SHA-256 hash for recursively equivalent object key orders", () => {
    const left = evidence({
      z: 3,
      nested: {
        beta: true,
        alpha: {
          two: 2,
          one: 1,
        },
      },
      a: "first",
    });
    const right = evidence({
      a: "first",
      nested: {
        alpha: {
          one: 1,
          two: 2,
        },
        beta: true,
      },
      z: 3,
    });

    expect(hashEvidenceMetadata(left)).toBe(hashEvidenceMetadata(right));
  });

  it("preserves array order when canonicalizing nested metadata", () => {
    const forward = hashEvidenceMetadata(
      evidence({ checks: ["primary", "secondary"] }),
    );
    const reverse = hashEvidenceMetadata(
      evidence({ checks: ["secondary", "primary"] }),
    );

    expect(forward).not.toBe(reverse);
  });

  it("returns exactly 64 lowercase hexadecimal characters", () => {
    expect(hashEvidenceMetadata(evidence({ result: "Passed" }))).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it("does not mutate caller metadata while canonicalizing it", () => {
    const metadata = {
      nested: { z: 2, a: 1 },
      values: [{ y: 2, x: 1 }, "stable"],
    };
    const before = structuredClone(metadata);

    hashEvidenceMetadata(evidence(metadata));

    expect(metadata).toEqual(before);
  });

  it("preserves a literal __proto__ metadata key in the canonical hash", () => {
    const withPrototypeKey = JSON.parse(
      '{"__proto__":{"polluted":true},"value":1}',
    ) as Record<string, unknown>;
    const withoutPrototypeKey = { value: 1 };

    expect(hashEvidenceMetadata(evidence(withPrototypeKey))).not.toBe(
      hashEvidenceMetadata(evidence(withoutPrototypeKey)),
    );
  });
});
