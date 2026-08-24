CREATE UNIQUE INDEX findings_organization_id_unique
ON findings (organization_id, id);

ALTER TABLE companies ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE findings ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);

CREATE TABLE organization_memberships (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Owner', 'Administrator', 'Member', 'Verifier')),
  status TEXT NOT NULL CHECK (status IN ('Active', 'Suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX organization_memberships_user_status_idx
ON organization_memberships (user_id, status, organization_id);

ALTER TABLE remediations RENAME TO remediations_legacy;
ALTER TABLE verification_runs RENAME TO verification_runs_legacy;
ALTER TABLE verification_checks RENAME TO verification_checks_legacy;
ALTER TABLE evidence_items RENAME TO evidence_items_legacy;
ALTER TABLE reports RENAME TO reports_legacy;

CREATE TABLE remediations (
  organization_id TEXT NOT NULL,
  id TEXT NOT NULL,
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
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, finding_id, id),
  FOREIGN KEY (organization_id, finding_id)
    REFERENCES findings(organization_id, id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX remediations_organization_finding_created_idx
ON remediations (organization_id, finding_id, created_at, id);

CREATE TABLE verification_runs (
  organization_id TEXT NOT NULL,
  id TEXT NOT NULL,
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
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, id, finding_id),
  FOREIGN KEY (organization_id, finding_id)
    REFERENCES findings(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, finding_id, remediation_id)
    REFERENCES remediations(organization_id, finding_id, id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX verification_runs_organization_finding_created_idx
ON verification_runs (organization_id, finding_id, created_at, id);

CREATE TABLE verification_checks (
  organization_id TEXT NOT NULL,
  id TEXT NOT NULL,
  verification_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('Pending', 'Passed', 'Failed', 'Skipped')
  ),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, verification_id, sequence),
  FOREIGN KEY (organization_id, verification_id)
    REFERENCES verification_runs(organization_id, id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE evidence_items (
  organization_id TEXT NOT NULL,
  id TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  verification_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  locked_at TEXT,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, finding_id)
    REFERENCES findings(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, verification_id, finding_id)
    REFERENCES verification_runs(organization_id, id, finding_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX evidence_items_organization_finding_created_idx
ON evidence_items (organization_id, finding_id, created_at, id);

CREATE INDEX evidence_items_organization_verification_created_idx
ON evidence_items (organization_id, verification_id, created_at, id);

CREATE TABLE reports (
  organization_id TEXT NOT NULL,
  id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  title TEXT NOT NULL,
  period_label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Draft', 'Ready')),
  snapshot_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, company_id)
    REFERENCES companies(organization_id, id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX reports_organization_company_generated_idx
ON reports (organization_id, company_id, generated_at DESC, id);

INSERT INTO remediations (
  organization_id, id, finding_id, status, summary, reference, owner,
  started_at, completed_at, created_at, updated_at, version
)
SELECT
  f.organization_id, r.id, r.finding_id, r.status, r.summary, r.reference,
  r.owner, r.started_at, r.completed_at, r.created_at, r.updated_at, 1
FROM remediations_legacy AS r
JOIN findings AS f ON f.id = r.finding_id;

INSERT INTO verification_runs (
  organization_id, id, finding_id, remediation_id, status, method,
  worker_name, scope, result_summary, started_at, completed_at, created_at,
  version
)
SELECT
  f.organization_id, v.id, v.finding_id, v.remediation_id, v.status,
  v.method, v.worker_name, v.scope, v.result_summary, v.started_at,
  v.completed_at, v.created_at, 1
FROM verification_runs_legacy AS v
JOIN findings AS f ON f.id = v.finding_id;

INSERT INTO verification_checks (
  organization_id, id, verification_id, sequence, name, status, message,
  created_at
)
SELECT
  v.organization_id, c.id, c.verification_id, c.sequence, c.name, c.status,
  c.message, c.created_at
FROM verification_checks_legacy AS c
JOIN verification_runs AS v ON v.id = c.verification_id;

INSERT INTO evidence_items (
  organization_id, id, finding_id, verification_id, kind, label,
  source_reference, content_hash, metadata_json, created_at, locked_at
)
SELECT
  f.organization_id, e.id, e.finding_id, e.verification_id, e.kind, e.label,
  e.source_reference, e.content_hash, e.metadata_json, e.created_at,
  e.locked_at
FROM evidence_items_legacy AS e
JOIN findings AS f ON f.id = e.finding_id;

INSERT INTO reports (
  organization_id, id, company_id, title, period_label, status, snapshot_json,
  generated_at, created_at
)
SELECT
  c.organization_id, r.id, r.company_id, r.title, r.period_label, r.status,
  r.snapshot_json, r.generated_at, r.created_at
FROM reports_legacy AS r
JOIN companies AS c ON c.id = r.company_id;

DROP TABLE evidence_items_legacy;
DROP TABLE verification_checks_legacy;
DROP TABLE verification_runs_legacy;
DROP TABLE remediations_legacy;
DROP TABLE reports_legacy;
