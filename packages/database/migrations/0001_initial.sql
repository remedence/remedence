CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  risk_level TEXT NOT NULL CHECK (
    risk_level IN ('Low', 'Medium', 'High', 'Critical')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  finding_key TEXT NOT NULL COLLATE NOCASE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  source TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (
    severity IN ('Critical', 'High', 'Medium', 'Low', 'Info')
  ),
  state TEXT NOT NULL CHECK (
    state IN (
      'Needs remediation',
      'Remediating',
      'Awaiting verification',
      'Verification failed',
      'Verified fixed'
    )
  ),
  owner TEXT NOT NULL,
  asset_name TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  sla_due_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, company_id)
    REFERENCES companies(organization_id, id) ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX findings_organization_key_unique
ON findings (organization_id, finding_key COLLATE NOCASE);

CREATE INDEX findings_organization_company_idx
ON findings (organization_id, company_id);

CREATE INDEX findings_organization_state_idx
ON findings (organization_id, state);

CREATE INDEX findings_organization_severity_idx
ON findings (organization_id, severity);

CREATE INDEX findings_organization_owner_idx
ON findings (organization_id, owner COLLATE NOCASE);

CREATE INDEX findings_organization_sla_idx
ON findings (organization_id, sla_due_at, detected_at, finding_key COLLATE NOCASE);

CREATE INDEX findings_organization_detected_idx
ON findings (organization_id, detected_at DESC, finding_key COLLATE NOCASE);

CREATE TABLE remediations (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('In progress', 'Completed', 'Cancelled')
  ),
  summary TEXT NOT NULL,
  reference TEXT NOT NULL,
  owner TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (finding_id, id),
  FOREIGN KEY (finding_id) REFERENCES findings(id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX remediations_finding_created_idx
ON remediations (finding_id, created_at, id);

CREATE TABLE verification_runs (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL,
  remediation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('Queued', 'Running', 'Passed', 'Failed', 'Cancelled')
  ),
  method TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  scope TEXT NOT NULL,
  result_summary TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (id, finding_id),
  FOREIGN KEY (finding_id) REFERENCES findings(id) ON DELETE RESTRICT,
  FOREIGN KEY (finding_id, remediation_id)
    REFERENCES remediations(finding_id, id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX verification_runs_finding_created_idx
ON verification_runs (finding_id, created_at, id);

CREATE TABLE verification_checks (
  id TEXT PRIMARY KEY,
  verification_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('Pending', 'Passed', 'Failed', 'Skipped')
  ),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (verification_id, sequence),
  FOREIGN KEY (verification_id) REFERENCES verification_runs(id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE evidence_items (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL,
  verification_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  locked_at TEXT,
  FOREIGN KEY (finding_id) REFERENCES findings(id) ON DELETE RESTRICT,
  FOREIGN KEY (verification_id, finding_id)
    REFERENCES verification_runs(id, finding_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX evidence_items_finding_created_idx
ON evidence_items (finding_id, created_at, id);

CREATE INDEX evidence_items_verification_created_idx
ON evidence_items (verification_id, created_at, id);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  title TEXT NOT NULL,
  period_label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Draft', 'Ready')),
  snapshot_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX reports_company_generated_idx
ON reports (company_id, generated_at DESC, id);

CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX audit_events_organization_id_idx
ON audit_events (organization_id, id);

CREATE INDEX audit_events_entity_order_idx
ON audit_events (organization_id, entity_type, entity_id, id);
