import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hashEvidenceMetadata,
  LocalDevelopmentMalwareScanner,
  LocalEvidenceObjectStore,
  signEvidenceManifest,
  verifyEvidenceManifest,
} from "../src/index.js";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

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

describe("protected evidence artifacts", () => {
  it("stores immutable content-addressed bytes and reads them back", async () => {
    const directory = mkdtempSync(join(tmpdir(), "remedence-evidence-"));
    temporaryDirectories.push(directory);
    const store = new LocalEvidenceObjectStore(directory);
    const bytes = Buffer.from("independent verification receipt", "utf8");

    const first = await store.put("org-one", bytes);
    const second = await store.put("org-one", bytes);

    expect(second.key).not.toBe(first.key);
    expect(second.contentHash).toBe(first.contentHash);
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await store.get(first.key)).toEqual(bytes);
    expect(await store.get(second.key)).toEqual(bytes);
  });

  it("rejects the EICAR test signature before object storage", async () => {
    const scanner = new LocalDevelopmentMalwareScanner();
    const receipt = await scanner.scan(
      Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE"),
      "2026-08-23T12:00:00.000Z",
    );
    expect(receipt).toMatchObject({ status: "Infected" });
  });

  it("detects manifest or signature tampering", () => {
    const manifest = { artifact_id: "artifact-1", sha256: "a".repeat(64) };
    const key = "manifest-signing-test-key-00000000000000";
    const signed = signEvidenceManifest(manifest, key);

    expect(
      verifyEvidenceManifest(
        manifest,
        key,
        signed.manifestHash,
        signed.signature,
      ),
    ).toBe(true);
    expect(
      verifyEvidenceManifest(
        { ...manifest, artifact_id: "artifact-2" },
        key,
        signed.manifestHash,
        signed.signature,
      ),
    ).toBe(false);
  });
});
