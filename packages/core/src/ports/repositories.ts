import type {
  AuditEvent,
  Company,
  EvidenceArtifact,
  EvidenceItem,
  Finding,
  FindingState,
  Remediation,
  Report,
  Severity,
  VerificationCheck,
  VerificationRun,
} from "../domain/entities.js";

export interface CursorPage<T> {
  items: T[];
  pageSize: number;
  total: number;
  nextCursor: string | null;
}

export interface FindingQuery {
  organizationId: string;
  search?: string;
  companyId?: string;
  state?: FindingState;
  severity?: Severity;
  owner?: string;
  sort: "priority" | "newest" | "sla";
  includeVerified: boolean;
  cursor?: string;
  pageSize: number;
}

export interface DashboardFinding extends Finding {
  companyName: string;
  slaBreached: boolean;
  priorityBucket: number;
}

export interface FindingDetail {
  finding: Finding;
  company: Company;
  remediations: Remediation[];
  verifications: Array<VerificationRun & { checks: VerificationCheck[] }>;
  evidence: EvidenceItem[];
  auditEvents: AuditEvent[];
}

export interface CompanyRepository {
  getById(organizationId: string, companyId: string): Company | undefined;
  list(organizationId: string): Company[];
  insert(company: Company): void;
}

export interface FindingRepository {
  getById(organizationId: string, findingId: string): Finding | undefined;
  findByKey(organizationId: string, findingKey: string): Finding | undefined;
  list(query: FindingQuery): CursorPage<DashboardFinding>;
  getDetail(
    organizationId: string,
    findingKey: string,
  ): FindingDetail | undefined;
  insert(finding: Finding): void;
  updateState(
    organizationId: string,
    id: string,
    expectedState: FindingState,
    state: FindingState,
    updatedAt: string,
  ): void;
}

export interface RemediationRepository {
  getById(organizationId: string, id: string): Remediation | undefined;
  listByFinding(organizationId: string, findingId: string): Remediation[];
  insert(remediation: Remediation): void;
  complete(
    organizationId: string,
    id: string,
    summary: string,
    reference: string,
    remediatorPrincipalId: string,
    completedAt: string,
    updatedAt: string,
  ): void;
}

export interface VerificationRepository {
  getById(organizationId: string, id: string): VerificationRun | undefined;
  listByFinding(organizationId: string, findingId: string): VerificationRun[];
  insert(run: VerificationRun): void;
  insertCheck(check: VerificationCheck): void;
  recordCheck(
    organizationId: string,
    verificationId: string,
    sequence: number,
    name: string,
    status: Exclude<VerificationCheck["status"], "Pending">,
    message: string,
  ): void;
  listChecks(
    organizationId: string,
    verificationId: string,
  ): VerificationCheck[];
  complete(
    organizationId: string,
    id: string,
    status: "Passed" | "Failed" | "Cancelled",
    summary: string,
    completedAt: string,
  ): void;
}

export interface EvidenceQuery {
  organizationId: string;
  findingId?: string;
  verificationId?: string;
  locked?: boolean;
  cursor?: string;
  pageSize: number;
}

export interface EvidenceRepository {
  getById(organizationId: string, evidenceId: string): EvidenceItem | undefined;
  list(query: EvidenceQuery): CursorPage<EvidenceItem>;
  insert(item: EvidenceItem): void;
  getArtifact?(
    organizationId: string,
    artifactId: string,
  ): EvidenceArtifact | undefined;
  insertArtifact?(artifact: EvidenceArtifact): void;
  adoptArtifact?(
    organizationId: string,
    artifactId: string,
    adoptedAt: string,
  ): boolean;
}

export interface ReportRepository {
  getById(organizationId: string, reportId: string): Report | undefined;
  listByCompany(organizationId: string, companyId: string): Report[];
  insert(report: Report): void;
}

export interface AuditEventQuery {
  organizationId: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  pageSize: number;
}

export interface AuditEventRepository {
  append(event: AuditEvent): void;
  list(query: AuditEventQuery): CursorPage<AuditEvent>;
}

export interface RepositorySet {
  companies: CompanyRepository;
  findings: FindingRepository;
  remediations: RemediationRepository;
  verifications: VerificationRepository;
  evidence: EvidenceRepository;
  reports: ReportRepository;
  auditEvents: AuditEventRepository;
}

export interface UnitOfWork {
  run<T>(operation: (repositories: RepositorySet) => T): T;
}
