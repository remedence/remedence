import { createHash } from "node:crypto";

export interface EvidenceHashInput {
  kind: string;
  label: string;
  sourceReference: string;
  metadata: Record<string, unknown>;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const sorted = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value).sort()) {
    sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function hashEvidenceMetadata(input: EvidenceHashInput): string {
  const canonical = JSON.stringify({
    kind: input.kind,
    label: input.label,
    source_reference: input.sourceReference,
    metadata: canonicalize(input.metadata),
  });

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
