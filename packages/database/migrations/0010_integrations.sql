CREATE TABLE integration_connections (
  organization_id TEXT NOT NULL,
  id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('generic-webhook', 'github-issues', 'scanner-webhook')),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Active', 'Disabled')),
  configuration_json TEXT NOT NULL,
  credential_key_version INTEGER NOT NULL CHECK (credential_key_version > 0),
  credential_iv TEXT NOT NULL,
  credential_ciphertext TEXT NOT NULL,
  credential_tag TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE integration_deliveries (
  organization_id TEXT NOT NULL,
  id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Queued', 'Running', 'Succeeded', 'Dead letter', 'Cancelled')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 20),
  available_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  response_status INTEGER,
  response_digest TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, connection_id, event_key),
  FOREIGN KEY (organization_id, connection_id)
    REFERENCES integration_connections(organization_id, id) ON DELETE CASCADE,
  CHECK (
    (status = 'Running' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (status <> 'Running' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE INDEX integration_deliveries_claim_idx
ON integration_deliveries (status, available_at, lease_expires_at, created_at, id);

CREATE TABLE integration_inbound_events (
  organization_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  payload_digest TEXT NOT NULL CHECK (length(payload_digest) = 64),
  received_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, connection_id, event_key),
  FOREIGN KEY (organization_id, connection_id)
    REFERENCES integration_connections(organization_id, id) ON DELETE CASCADE
);
