CREATE TABLE verification_jobs (
  organization_id TEXT NOT NULL,
  id TEXT NOT NULL,
  verification_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Queued', 'Running', 'Succeeded', 'Failed', 'Cancelled', 'Dead letter')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 10),
  timeout_seconds INTEGER NOT NULL CHECK (timeout_seconds BETWEEN 1 AND 3600),
  available_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  cancellation_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancellation_requested IN (0, 1)),
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, verification_id),
  FOREIGN KEY (organization_id, verification_id)
    REFERENCES verification_runs(organization_id, id) ON DELETE CASCADE,
  CHECK (
    (status = 'Running' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (status <> 'Running' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE INDEX verification_jobs_claim_idx
ON verification_jobs (status, available_at, lease_expires_at, created_at, id);

CREATE TABLE verification_execution_receipts (
  organization_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  worker_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  image_digest TEXT NOT NULL CHECK (length(image_digest) = 71),
  command_digest TEXT NOT NULL CHECK (length(command_digest) = 64),
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  exit_code INTEGER,
  timed_out INTEGER NOT NULL CHECK (timed_out IN (0, 1)),
  output_hash TEXT NOT NULL CHECK (length(output_hash) = 64),
  signature TEXT NOT NULL CHECK (length(signature) = 64),
  PRIMARY KEY (organization_id, job_id, attempt),
  FOREIGN KEY (organization_id, job_id)
    REFERENCES verification_jobs(organization_id, id) ON DELETE CASCADE
);
