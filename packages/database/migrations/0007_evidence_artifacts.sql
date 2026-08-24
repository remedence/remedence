CREATE TABLE evidence_artifacts (
  organization_id TEXT NOT NULL,
  id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  media_type TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  scan_status TEXT NOT NULL CHECK (scan_status IN ('Clean', 'Infected')),
  scanner TEXT NOT NULL,
  scan_receipt_json TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  retention_until TEXT NOT NULL,
  legal_hold INTEGER NOT NULL DEFAULT 0 CHECK (legal_hold IN (0, 1)),
  adopted_at TEXT,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, object_key),
  FOREIGN KEY (organization_id)
    REFERENCES organizations(id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX evidence_artifacts_retention_idx
ON evidence_artifacts (organization_id, retention_until, adopted_at);

ALTER TABLE evidence_items RENAME TO evidence_items_metadata_legacy;

CREATE TABLE evidence_items (
  organization_id TEXT NOT NULL,
  id TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  verification_id TEXT NOT NULL,
  artifact_id TEXT,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  manifest_hash TEXT CHECK (manifest_hash IS NULL OR length(manifest_hash) = 64),
  manifest_signature TEXT CHECK (manifest_signature IS NULL OR length(manifest_signature) = 64),
  attested_by TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  locked_at TEXT,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, finding_id)
    REFERENCES findings(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, verification_id, finding_id)
    REFERENCES verification_runs(organization_id, id, finding_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, artifact_id)
    REFERENCES evidence_artifacts(organization_id, id) ON DELETE RESTRICT
) STRICT;

INSERT INTO evidence_items (
  organization_id, id, finding_id, verification_id, artifact_id, kind, label,
  source_reference, content_hash, manifest_hash, manifest_signature,
  attested_by, metadata_json, created_at, locked_at
)
SELECT
  organization_id, id, finding_id, verification_id, NULL, kind, label,
  source_reference, content_hash, NULL, NULL, NULL, metadata_json, created_at,
  locked_at
FROM evidence_items_metadata_legacy;

DROP TABLE evidence_items_metadata_legacy;

CREATE INDEX evidence_items_organization_finding_created_idx
ON evidence_items (organization_id, finding_id, created_at, id);

CREATE INDEX evidence_items_organization_verification_created_idx
ON evidence_items (organization_id, verification_id, created_at, id);

CREATE UNIQUE INDEX evidence_items_artifact_uidx
ON evidence_items (organization_id, artifact_id)
WHERE artifact_id IS NOT NULL;
