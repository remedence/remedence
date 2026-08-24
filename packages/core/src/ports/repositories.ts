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

export type RepositoryResult<T> = T | Promise<T>;

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
  getById(
    organizationId: string,
    companyId: string,
  ): RepositoryResult<Company | undefined>;
  list(organizationId: string): RepositoryResult<Company[]>;
  insert(company: Company): RepositoryResult<void>;
}

export interface FindingRepository {
  getById(
    organizationId: string,
    findingId: string,
  ): RepositoryResult<Finding | undefined>;
  findByKey(
    organizationId: string,
    findingKey: string,
  ): RepositoryResult<Finding | undefined>;
  list(query: FindingQuery): RepositoryResult<CursorPage<DashboardFinding>>;
  getDetail(
    organizationId: string,
    findingKey: string,
  ): RepositoryResult<FindingDetail | undefined>;
  insert(finding: Finding): RepositoryResult<void>;
  updateState(
    organizationId: string,
    id: string,
    expectedState: FindingState,
    state: FindingState,
    updatedAt: string,
  ): RepositoryResult<void>;
}

export interface RemediationRepository {
  getById(
    organizationId: string,
    id: string,
  ): RepositoryResult<Remediation | undefined>;
  listByFinding(
    organizationId: string,
    findingId: string,
  ): RepositoryResult<Remediation[]>;
  insert(remediation: Remediation): RepositoryResult<void>;
  complete(
    organizationId: string,
    id: string,
    summary: string,
    reference: string,
    remediatorPrincipalId: string,
    completedAt: string,
    updatedAt: string,
  ): RepositoryResult<void>;
}

export interface VerificationRepository {
  getById(
    organizationId: string,
    id: string,
  ): RepositoryResult<VerificationRun | undefined>;
  listByFinding(
    organizationId: string,
    findingId: string,
  ): RepositoryResult<VerificationRun[]>;
  insert(run: VerificationRun): RepositoryResult<void>;
  insertCheck(check: VerificationCheck): RepositoryResult<void>;
  recordCheck(
    organizationId: string,
    verificationId: string,
    sequence: number,
    name: string,
    status: Exclude<VerificationCheck["status"], "Pending">,
    message: string,
  ): RepositoryResult<void>;
  listChecks(
    organizationId: string,
    verificationId: string,
  ): RepositoryResult<VerificationCheck[]>;
  complete(
    organizationId: string,
    id: string,
    status: "Passed" | "Failed" | "Cancelled",
    summary: string,
    completedAt: string,
  ): RepositoryResult<void>;
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
  getById(
    organizationId: string,
    evidenceId: string,
  ): RepositoryResult<EvidenceItem | undefined>;
  list(query: EvidenceQuery): RepositoryResult<CursorPage<EvidenceItem>>;
  insert(item: EvidenceItem): RepositoryResult<void>;
  getArtifact?(
    organizationId: string,
    artifactId: string,
  ): RepositoryResult<EvidenceArtifact | undefined>;
  insertArtifact?(artifact: EvidenceArtifact): RepositoryResult<void>;
  adoptArtifact?(
    organizationId: string,
    artifactId: string,
    adoptedAt: string,
  ): RepositoryResult<boolean>;
}

export interface ReportRepository {
  getById(
    organizationId: string,
    reportId: string,
  ): RepositoryResult<Report | undefined>;
  listByCompany(
    organizationId: string,
    companyId: string,
  ): RepositoryResult<Report[]>;
  insert(report: Report): RepositoryResult<void>;
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
  append(event: AuditEvent): RepositoryResult<void>;
  list(query: AuditEventQuery): RepositoryResult<CursorPage<AuditEvent>>;
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
  run<T>(
    operation: (repositories: RepositorySet) => RepositoryResult<T>,
  ): Promise<T>;
}
