CREATE TABLE idempotency_records (
  organization_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  state TEXT NOT NULL CHECK (state IN ('Pending', 'Completed')),
  status_code INTEGER,
  response_headers_json TEXT,
  response_body_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, actor_id, idempotency_key),
  CHECK (
    (state = 'Pending' AND status_code IS NULL AND response_headers_json IS NULL AND response_body_json IS NULL AND completed_at IS NULL)
    OR
    (state = 'Completed' AND status_code BETWEEN 200 AND 299 AND response_headers_json IS NOT NULL AND response_body_json IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX idempotency_records_expiry_idx
ON idempotency_records (state, expires_at, organization_id, actor_id);
