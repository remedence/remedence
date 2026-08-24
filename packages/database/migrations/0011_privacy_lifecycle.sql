CREATE TABLE organization_privacy_settings (
  organization_id TEXT PRIMARY KEY,
  unadopted_artifact_retention_days INTEGER NOT NULL DEFAULT 30
    CHECK (unadopted_artifact_retention_days BETWEEN 1 AND 3650),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE privacy_deletion_receipts (
  id TEXT PRIMARY KEY,
  organization_digest TEXT NOT NULL CHECK (length(organization_digest) = 64),
  requested_by TEXT NOT NULL,
  object_keys_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending object cleanup', 'Complete')),
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX evidence_artifacts_global_retention_idx
ON evidence_artifacts (retention_until, legal_hold, adopted_at, organization_id, id);
