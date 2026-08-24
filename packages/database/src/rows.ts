import type {
  AuditEvent,
  Company,
  DashboardFinding,
  EvidenceArtifact,
  EvidenceItem,
  Finding,
  FindingState,
  Organization,
  Remediation,
  RemediationStatus,
  Report,
  ReportSnapshot,
  ReportStatus,
  RiskLevel,
  Severity,
  VerificationCheck,
  VerificationCheckStatus,
  VerificationRun,
  VerificationStatus,
} from "@remedence/core";

const RISK_LEVELS = ["Low", "Medium", "High", "Critical"] as const;
const SEVERITIES = ["Critical", "High", "Medium", "Low", "Info"] as const;
const FINDING_STATES = [
  "Needs remediation",
  "Remediating",
  "Awaiting verification",
  "Verification failed",
  "Verified fixed",
] as const;
const REMEDIATION_STATUSES = ["In progress", "Completed", "Cancelled"] as const;
const VERIFICATION_STATUSES = [
  "Queued",
  "Running",
  "Passed",
  "Failed",
  "Cancelled",
] as const;
const VERIFICATION_CHECK_STATUSES = [
  "Pending",
  "Passed",
  "Failed",
  "Skipped",
] as const;
const VERIFICATION_CREDENTIAL_TYPES = [
  "session",
  "local-process",
  "worker-profile",
  "legacy-assertion",
] as const;
const REPORT_STATUSES = ["Draft", "Ready"] as const;

type Row = Record<string, unknown>;

function requireRow(value: unknown): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("SQLite row must be a non-null object.");
  }
  return value as Row;
}

function requireString(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new TypeError(`SQLite column ${key} must be a string.`);
  }
  return value;
}

function requireNullableString(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new TypeError(`SQLite column ${key} must be a string or null.`);
  }
  return value;
}

function requireNumber(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`SQLite column ${key} must be a finite number.`);
  }
  return value;
}

function requireInteger(row: Row, key: string): number {
  const value = requireNumber(row, key);
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`SQLite column ${key} must be a safe integer.`);
  }
  return value;
}

function requireBooleanInteger(row: Row, key: string): boolean {
  const value = requireInteger(row, key);
  if (value === 0) return false;
  if (value === 1) return true;
  throw new TypeError(`SQLite column ${key} must be 0 or 1.`);
}

function requireEnum<const Values extends readonly string[]>(
  row: Row,
  key: string,
  values: Values,
): Values[number] {
  const value = requireString(row, key);
  if (!(values as readonly string[]).includes(value)) {
    throw new TypeError(
      `SQLite column ${key} contains unsupported value ${JSON.stringify(value)}.`,
    );
  }
  return value as Values[number];
}

function parseObjectJson(row: Row, key: string): Record<string, unknown> {
  const raw = requireString(row, key);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new TypeError(`SQLite column ${key} must contain valid JSON.`, {
      cause: error,
    });
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`SQLite column ${key} must contain a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function parseReportSnapshot(row: Row): ReportSnapshot {
  const value = parseObjectJson(row, "snapshot_json");
  const requiredStrings = ["companyName"] as const;
  const requiredNumbers = [
    "riskScore",
    "criticalFindings",
    "highFindings",
    "verifiedFixes",
    "slaCompliancePercent",
  ] as const;
  for (const key of requiredStrings) {
    if (typeof value[key] !== "string") {
      throw new TypeError(`Report snapshot ${key} must be a string.`);
    }
  }
  for (const key of requiredNumbers) {
    if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
      throw new TypeError(`Report snapshot ${key} must be a finite number.`);
    }
  }
  if (
    !Array.isArray(value.findings) ||
    !Array.isArray(value.verificationHistory)
  ) {
    throw new TypeError(
      "Report snapshot findings and verificationHistory must be arrays.",
    );
  }
  return value as unknown as ReportSnapshot;
}

export function mapOrganizationRow(value: unknown): Organization {
  const row = requireRow(value);
  return {
    id: requireString(row, "id"),
    name: requireString(row, "name"),
    createdAt: requireString(row, "created_at"),
  };
}

export function mapCompanyRow(value: unknown): Company {
  const row = requireRow(value);
  return {
    id: requireString(row, "id"),
    organizationId: requireString(row, "organization_id"),
    name: requireString(row, "name"),
    riskScore: requireNumber(row, "risk_score"),
    riskLevel: requireEnum(row, "risk_level", RISK_LEVELS) as RiskLevel,
    createdAt: requireString(row, "created_at"),
    updatedAt: requireString(row, "updated_at"),
    version: requireInteger(row, "version"),
  };
}

export function mapFindingRow(value: unknown): Finding {
  const row = requireRow(value);
  return {
    id: requireString(row, "id"),
    organizationId: requireString(row, "organization_id"),
    companyId: requireString(row, "company_id"),
    findingKey: requireString(row, "finding_key"),
    title: requireString(row, "title"),
    description: requireString(row, "description"),
    source: requireString(row, "source"),
    severity: requireEnum(row, "severity", SEVERITIES) as Severity,
    state: requireEnum(row, "state", FINDING_STATES) as FindingState,
    owner: requireString(row, "owner"),
    assetName: requireString(row, "asset_name"),
    detectedAt: requireString(row, "detected_at"),
    slaDueAt: requireString(row, "sla_due_at"),
    createdAt: requireString(row, "created_at"),
    updatedAt: requireString(row, "updated_at"),
    version: requireInteger(row, "version"),
  };
}

export function mapDashboardFindingRow(value: unknown): DashboardFinding {
  const row = requireRow(value);
  return {
    ...mapFindingRow(row),
    companyName: requireString(row, "company_name"),
    slaBreached: requireBooleanInteger(row, "sla_breached"),
    priorityBucket: requireInteger(row, "priority_bucket"),
  };
}

export function mapRemediationRow(value: unknown): Remediation {
  const row = requireRow(value);
  return {
    organizationId: requireString(row, "organization_id"),
    id: requireString(row, "id"),
    findingId: requireString(row, "finding_id"),
    status: requireEnum(
      row,
      "status",
      REMEDIATION_STATUSES,
    ) as RemediationStatus,
    summary: requireString(row, "summary"),
    reference: requireString(row, "reference"),
    owner: requireString(row, "owner"),
    remediatorPrincipalId: requireString(row, "remediator_principal_id"),
    startedAt: requireString(row, "started_at"),
    completedAt: requireNullableString(row, "completed_at"),
    createdAt: requireString(row, "created_at"),
    updatedAt: requireString(row, "updated_at"),
    version: requireInteger(row, "version"),
  };
}

export function mapVerificationRunRow(value: unknown): VerificationRun {
  const row = requireRow(value);
  return {
    organizationId: requireString(row, "organization_id"),
    id: requireString(row, "id"),
    findingId: requireString(row, "finding_id"),
    remediationId: requireString(row, "remediation_id"),
    status: requireEnum(
      row,
      "status",
      VERIFICATION_STATUSES,
    ) as VerificationStatus,
    method: requireString(row, "method"),
    workerName: requireString(row, "worker_name"),
    verifierPrincipalId: requireString(row, "verifier_principal_id"),
    credentialType: requireEnum(
      row,
      "credential_type",
      VERIFICATION_CREDENTIAL_TYPES,
    ) as VerificationRun["credentialType"],
    executionSource: requireString(row, "execution_source"),
    sourceRevision: requireString(row, "source_revision"),
    patchDigest: requireString(row, "patch_digest"),
    scope: requireString(row, "scope"),
    resultSummary: requireString(row, "result_summary"),
    startedAt: requireString(row, "started_at"),
    completedAt: requireNullableString(row, "completed_at"),
    createdAt: requireString(row, "created_at"),
    version: requireInteger(row, "version"),
  };
}

export function mapVerificationCheckRow(value: unknown): VerificationCheck {
  const row = requireRow(value);
  return {
    organizationId: requireString(row, "organization_id"),
    id: requireString(row, "id"),
    verificationId: requireString(row, "verification_id"),
    sequence: requireInteger(row, "sequence"),
    name: requireString(row, "name"),
    status: requireEnum(
      row,
      "status",
      VERIFICATION_CHECK_STATUSES,
    ) as VerificationCheckStatus,
    message: requireString(row, "message"),
    createdAt: requireString(row, "created_at"),
  };
}

export function mapEvidenceItemRow(value: unknown): EvidenceItem {
  const row = requireRow(value);
  return {
    organizationId: requireString(row, "organization_id"),
    id: requireString(row, "id"),
    findingId: requireString(row, "finding_id"),
    verificationId: requireString(row, "verification_id"),
    kind: requireString(row, "kind"),
    label: requireString(row, "label"),
    sourceReference: requireString(row, "source_reference"),
    contentHash: requireString(row, "content_hash"),
    artifactId: requireNullableString(row, "artifact_id"),
    manifestHash: requireNullableString(row, "manifest_hash"),
    manifestSignature: requireNullableString(row, "manifest_signature"),
    attestedBy: requireNullableString(row, "attested_by"),
    metadata: parseObjectJson(row, "metadata_json"),
    createdAt: requireString(row, "created_at"),
    lockedAt: requireNullableString(row, "locked_at"),
  };
}

export function mapEvidenceArtifactRow(value: unknown): EvidenceArtifact {
  const row = requireRow(value);
  return {
    organizationId: requireString(row, "organization_id"),
    id: requireString(row, "id"),
    objectKey: requireString(row, "object_key"),
    contentHash: requireString(row, "content_hash"),
    size: requireInteger(row, "size_bytes"),
    mediaType: requireString(row, "media_type"),
    originalFilename: requireString(row, "original_filename"),
    scanStatus: requireEnum(row, "scan_status", ["Clean", "Infected"]),
    scanner: requireString(row, "scanner"),
    scanReceipt: parseObjectJson(row, "scan_receipt_json"),
    uploadedBy: requireString(row, "uploaded_by"),
    createdAt: requireString(row, "created_at"),
    retentionUntil: requireString(row, "retention_until"),
    legalHold: requireBooleanInteger(row, "legal_hold"),
    adoptedAt: requireNullableString(row, "adopted_at"),
  };
}

export function mapReportRow(value: unknown): Report {
  const row = requireRow(value);
  return {
    organizationId: requireString(row, "organization_id"),
    id: requireString(row, "id"),
    companyId: requireString(row, "company_id"),
    title: requireString(row, "title"),
    periodLabel: requireString(row, "period_label"),
    status: requireEnum(row, "status", REPORT_STATUSES) as ReportStatus,
    snapshot: parseReportSnapshot(row),
    generatedAt: requireString(row, "generated_at"),
    createdAt: requireString(row, "created_at"),
  };
}

export function mapAuditEventRow(value: unknown): AuditEvent {
  const row = requireRow(value);
  return {
    id: requireInteger(row, "id"),
    organizationId: requireString(row, "organization_id"),
    actorType: requireString(row, "actor_type"),
    actorId: requireString(row, "actor_id"),
    action: requireString(row, "action"),
    entityType: requireString(row, "entity_type"),
    entityId: requireString(row, "entity_id"),
    details: parseObjectJson(row, "details_json"),
    occurredAt: requireString(row, "occurred_at"),
  };
}
