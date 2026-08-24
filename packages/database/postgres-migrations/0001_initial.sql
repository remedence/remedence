CREATE TABLE IF NOT EXISTS remedence_schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS remedence_organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS remedence_entities (
  organization_id text NOT NULL REFERENCES remedence_organizations(id) ON DELETE RESTRICT,
  entity_type text NOT NULL CHECK (entity_type IN (
    'company', 'finding', 'remediation', 'verification',
    'verification-check', 'evidence', 'evidence-artifact', 'report'
  )),
  entity_id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, entity_type, entity_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS remedence_findings_tenant_key_uidx
ON remedence_entities (organization_id, upper(payload->>'findingKey'))
WHERE entity_type = 'finding';

CREATE INDEX IF NOT EXISTS remedence_entities_tenant_type_created_idx
ON remedence_entities (organization_id, entity_type, created_at, entity_id);

CREATE INDEX IF NOT EXISTS remedence_findings_company_idx
ON remedence_entities (organization_id, (payload->>'companyId'), (payload->>'findingKey'))
WHERE entity_type = 'finding';

CREATE INDEX IF NOT EXISTS remedence_remediations_finding_idx
ON remedence_entities (organization_id, (payload->>'findingId'), created_at, entity_id)
WHERE entity_type = 'remediation';

CREATE INDEX IF NOT EXISTS remedence_verifications_finding_idx
ON remedence_entities (organization_id, (payload->>'findingId'), created_at, entity_id)
WHERE entity_type = 'verification';

CREATE UNIQUE INDEX IF NOT EXISTS remedence_verification_check_sequence_uidx
ON remedence_entities (
  organization_id,
  (payload->>'verificationId'),
  ((payload->>'sequence')::integer)
)
WHERE entity_type = 'verification-check';

CREATE INDEX IF NOT EXISTS remedence_evidence_finding_idx
ON remedence_entities (organization_id, (payload->>'findingId'), created_at DESC, entity_id DESC)
WHERE entity_type = 'evidence';

CREATE INDEX IF NOT EXISTS remedence_reports_company_idx
ON remedence_entities (organization_id, (payload->>'companyId'), (payload->>'generatedAt') DESC, entity_id DESC)
WHERE entity_type = 'report';

CREATE TABLE IF NOT EXISTS remedence_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES remedence_organizations(id) ON DELETE RESTRICT,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  details jsonb NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS remedence_audit_tenant_sequence_idx
ON remedence_audit_events (organization_id, id);

CREATE INDEX IF NOT EXISTS remedence_audit_tenant_entity_idx
ON remedence_audit_events (organization_id, entity_type, entity_id, id);

CREATE TABLE IF NOT EXISTS remedence_rate_limit_buckets (
  bucket_key text PRIMARY KEY,
  window_started_at bigint NOT NULL,
  request_count integer NOT NULL CHECK (request_count >= 1),
  updated_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS remedence_idempotency_records (
  organization_id text NOT NULL REFERENCES remedence_organizations(id) ON DELETE RESTRICT,
  actor_id text NOT NULL,
  idempotency_key text NOT NULL,
  operation text NOT NULL,
  request_hash text NOT NULL,
  state text NOT NULL CHECK (state IN ('Pending', 'Completed')),
  status_code integer,
  response_headers jsonb,
  response_body jsonb,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, actor_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS remedence_operational_records (
  organization_id text NOT NULL,
  record_kind text NOT NULL,
  record_id text NOT NULL,
  secondary_key text,
  status text NOT NULL,
  available_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, record_kind, record_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS remedence_operational_secondary_uidx
ON remedence_operational_records (organization_id, record_kind, secondary_key)
WHERE secondary_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS remedence_operational_claim_idx
ON remedence_operational_records (
  record_kind, status, available_at, created_at, record_id
);

CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL,
  "image" text,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  "twoFactorEnabled" boolean
);

CREATE TABLE IF NOT EXISTS organization_memberships (
  organization_id text NOT NULL REFERENCES remedence_organizations(id) ON DELETE RESTRICT,
  user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('Owner', 'Administrator', 'Member', 'Verifier')),
  status text NOT NULL CHECK (status IN ('Active', 'Suspended')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS organization_memberships_user_status_idx
ON organization_memberships (user_id, status, organization_id);

CREATE TABLE IF NOT EXISTS "session" (
  "id" text PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session"("userId");

CREATE TABLE IF NOT EXISTS "account" (
  "id" text PRIMARY KEY,
  "issuer" text NOT NULL,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  UNIQUE ("issuer", "accountId")
);
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account"("userId");

CREATE TABLE IF NOT EXISTS "verification" (
  "id" text PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification"("identifier");

CREATE TABLE IF NOT EXISTS "twoFactor" (
  "id" text PRIMARY KEY,
  "secret" text NOT NULL,
  "backupCodes" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "verified" boolean,
  "failedVerificationCount" integer,
  "lockedUntil" timestamptz
);
CREATE INDEX IF NOT EXISTS "twoFactor_userId_idx" ON "twoFactor"("userId");

CREATE TABLE IF NOT EXISTS "ssoProvider" (
  "id" text PRIMARY KEY,
  "issuer" text NOT NULL,
  "oidcConfig" text,
  "samlConfig" text,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "providerId" text NOT NULL UNIQUE,
  "organizationId" text REFERENCES remedence_organizations(id) ON DELETE CASCADE,
  "domain" text NOT NULL,
  "domainVerified" boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS "ssoProvider_userId_idx" ON "ssoProvider"("userId");
CREATE INDEX IF NOT EXISTS "ssoProvider_organizationId_idx" ON "ssoProvider"("organizationId");
CREATE INDEX IF NOT EXISTS "ssoProvider_domain_idx" ON "ssoProvider"("domain");
