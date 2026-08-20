import type {
  Finding,
  Report,
  ReportSnapshot,
  VerificationCheck,
  VerificationRun,
} from "../domain/entities.js";
import { DomainError } from "../errors/domain-error.js";
import type {
  DashboardFinding,
  RepositorySet,
  UnitOfWork,
} from "../ports/repositories.js";
import type { Clock, IdGenerator } from "../ports/runtime.js";
import type { MutationActor } from "./import-finding.js";

export interface ReportServiceDependencies {
  unitOfWork: UnitOfWork;
  clock: Clock;
  idGenerator: IdGenerator;
}

export interface CreateReportInput {
  organizationId: string;
  companyId: string;
  periodLabel: string;
  actor: MutationActor;
}

function toFinding(row: DashboardFinding): Finding {
  const {
    companyName: _companyName,
    slaBreached: _slaBreached,
    priorityBucket: _priorityBucket,
    ...finding
  } = row;
  return finding;
}

function listCompanyFindings(
  repositories: RepositorySet,
  organizationId: string,
  companyId: string,
): DashboardFinding[] {
  const rows: DashboardFinding[] = [];
  const pageSize = 100;
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  while (rows.length < total) {
    const result = repositories.findings.list({
      organizationId,
      companyId,
      sort: "priority",
      includeVerified: true,
      page,
      pageSize,
    });
    total = result.total;
    rows.push(...result.items);
    if (result.items.length === 0) break;
    page += 1;
  }
  return rows;
}

function verificationHistory(
  repositories: RepositorySet,
  findingRows: DashboardFinding[],
): Array<VerificationRun & { checks: VerificationCheck[] }> {
  return findingRows
    .flatMap((finding) =>
      repositories.verifications.listByFinding(finding.id).map((run) => ({
        ...run,
        checks: repositories.verifications.listChecks(run.id),
      })),
    )
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
}

export class ReportService {
  constructor(private readonly dependencies: ReportServiceDependencies) {}

  createReport(input: CreateReportInput): Report {
    return this.dependencies.unitOfWork.run((repositories) => {
      const company = repositories.companies.getById(
        input.organizationId,
        input.companyId,
      );
      if (!company) {
        throw new DomainError(
          "COMPANY_NOT_FOUND",
          404,
          "Company was not found.",
        );
      }
      const periodLabel = input.periodLabel.trim();
      if (!periodLabel) {
        throw new DomainError(
          "REPORT_PERIOD_REQUIRED",
          409,
          "Report period label is required.",
        );
      }

      const rows = listCompanyFindings(
        repositories,
        input.organizationId,
        input.companyId,
      );
      const openRows = rows.filter((row) => row.state !== "Verified fixed");
      const slaBreaches = openRows.filter((row) => row.slaBreached).length;
      const snapshot: ReportSnapshot = {
        companyName: company.name,
        riskScore: company.riskScore,
        criticalFindings: openRows.filter((row) => row.severity === "Critical")
          .length,
        highFindings: openRows.filter((row) => row.severity === "High").length,
        verifiedFixes: rows.filter((row) => row.state === "Verified fixed")
          .length,
        slaCompliancePercent:
          openRows.length === 0
            ? 100
            : Math.round(
                ((openRows.length - slaBreaches) / openRows.length) * 10_000,
              ) / 100,
        findings: rows.map(toFinding),
        verificationHistory: verificationHistory(repositories, rows),
      };

      const now = this.dependencies.clock.now();
      const report: Report = {
        id: this.dependencies.idGenerator.next(),
        companyId: company.id,
        title: `${company.name} — ${periodLabel} Security Review`,
        periodLabel,
        status: "Ready",
        snapshot,
        generatedAt: now,
        createdAt: now,
      };
      repositories.reports.insert(report);
      repositories.auditEvents.append({
        organizationId: input.organizationId,
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        action: "report.generated",
        entityType: "report",
        entityId: report.id,
        details: { company_id: company.id, period_label: periodLabel },
        occurredAt: now,
      });
      return report;
    });
  }
}
