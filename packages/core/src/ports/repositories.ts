import type {
  AuditEvent,
  Company,
  EvidenceItem,
  Finding,
  FindingState,
  Remediation,
  Report,
  Severity,
  VerificationCheck,
  VerificationRun,
} from "../domain/entities.js";

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
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
  page: number;
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
  list(query: FindingQuery): Page<DashboardFinding>;
  getDetail(
    organizationId: string,
    findingKey: string,
  ): FindingDetail | undefined;
  insert(finding: Finding): void;
  updateState(
    id: string,
    expectedState: FindingState,
    state: FindingState,
    updatedAt: string,
  ): void;
}

export interface RemediationRepository {
  getById(id: string): Remediation | undefined;
  listByFinding(findingId: string): Remediation[];
  insert(remediation: Remediation): void;
  complete(
    id: string,
    summary: string,
    reference: string,
    completedAt: string,
    updatedAt: string,
  ): void;
}

export interface VerificationRepository {
  getById(id: string): VerificationRun | undefined;
  listByFinding(findingId: string): VerificationRun[];
  insert(run: VerificationRun): void;
  insertCheck(check: VerificationCheck): void;
  recordCheck(
    verificationId: string,
    sequence: number,
    name: string,
    status: Exclude<VerificationCheck["status"], "Pending">,
    message: string,
  ): void;
  listChecks(verificationId: string): VerificationCheck[];
  complete(
    id: string,
    status: "Passed" | "Failed",
    summary: string,
    completedAt: string,
  ): void;
}

export interface EvidenceQuery {
  organizationId: string;
  findingId?: string;
  verificationId?: string;
  locked?: boolean;
}

export interface EvidenceRepository {
  getById(organizationId: string, evidenceId: string): EvidenceItem | undefined;
  list(query: EvidenceQuery): EvidenceItem[];
  insert(item: EvidenceItem): void;
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
  page: number;
  pageSize: number;
}

export interface AuditEventRepository {
  append(event: AuditEvent): void;
  list(query: AuditEventQuery): Page<AuditEvent>;
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
