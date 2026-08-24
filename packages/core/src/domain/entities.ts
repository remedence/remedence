export type Severity = "Critical" | "High" | "Medium" | "Low" | "Info";

export type FindingState =
  | "Needs remediation"
  | "Remediating"
  | "Awaiting verification"
  | "Verification failed"
  | "Verified fixed";

export type RiskLevel = "Low" | "Medium" | "High" | "Critical";
export type RemediationStatus = "In progress" | "Completed" | "Cancelled";
export type VerificationStatus =
  "Queued" | "Running" | "Passed" | "Failed" | "Cancelled";
export type VerificationCheckStatus =
  "Pending" | "Passed" | "Failed" | "Skipped";
export type ReportStatus = "Draft" | "Ready";

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
}

export interface Company {
  id: string;
  organizationId: string;
  name: string;
  riskScore: number;
  riskLevel: RiskLevel;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface Finding {
  id: string;
  organizationId: string;
  companyId: string;
  findingKey: string;
  title: string;
  description: string;
  source: string;
  severity: Severity;
  state: FindingState;
  owner: string;
  assetName: string;
  detectedAt: string;
  slaDueAt: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface Remediation {
  organizationId: string;
  id: string;
  findingId: string;
  status: RemediationStatus;
  summary: string;
  reference: string;
  owner: string;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface VerificationRun {
  organizationId: string;
  id: string;
  findingId: string;
  remediationId: string;
  status: VerificationStatus;
  method: string;
  workerName: string;
  scope: string;
  resultSummary: string;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  version: number;
}

export interface VerificationCheck {
  organizationId: string;
  id: string;
  verificationId: string;
  sequence: number;
  name: string;
  status: VerificationCheckStatus;
  message: string;
  createdAt: string;
}

export interface EvidenceItem {
  organizationId: string;
  id: string;
  findingId: string;
  verificationId: string;
  kind: string;
  label: string;
  sourceReference: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  lockedAt: string | null;
}

export interface AuditEvent {
  id?: number;
  organizationId: string;
  actorType: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  occurredAt: string;
}

export interface ImportRecord {
  id: string;
  source: string;
  findingId: string;
  createdAt: string;
}

export interface CompanyRiskSummary {
  companyId: string;
  companyName: string;
  riskScore: number;
  riskLevel: RiskLevel;
  openFindings: number;
  awaitingVerification: number;
  verificationFailed: number;
}

export interface VerificationActivity {
  verificationId: string;
  findingKey: string;
  companyName: string;
  status: VerificationStatus;
  resultSummary: string;
  completedAt: string | null;
}

export interface NotificationItem {
  id: string;
  status: "attention" | "resolved";
  message: string;
}

export interface ReportSnapshot {
  companyName: string;
  riskScore: number;
  criticalFindings: number;
  highFindings: number;
  verifiedFixes: number;
  slaCompliancePercent: number;
  findings: Finding[];
  verificationHistory: Array<VerificationRun & { checks: VerificationCheck[] }>;
}

export interface Report {
  organizationId: string;
  id: string;
  companyId: string;
  title: string;
  periodLabel: string;
  status: ReportStatus;
  snapshot: ReportSnapshot;
  generatedAt: string;
  createdAt: string;
}
