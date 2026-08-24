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

async function listCompanyFindings(
  repositories: RepositorySet,
  organizationId: string,
  companyId: string,
): Promise<DashboardFinding[]> {
  const rows: DashboardFinding[] = [];
  const pageSize = 100;
  let cursor: string | undefined;
  do {
    const result = await repositories.findings.list({
      organizationId,
      companyId,
      sort: "priority",
      includeVerified: true,
      pageSize,
      ...(cursor ? { cursor } : {}),
    });
    rows.push(...result.items);
    cursor = result.nextCursor ?? undefined;
  } while (cursor);
  return rows;
}

async function verificationHistory(
  repositories: RepositorySet,
  organizationId: string,
  findingRows: DashboardFinding[],
): Promise<Array<VerificationRun & { checks: VerificationCheck[] }>> {
  const groups = await Promise.all(
    findingRows.map(async (finding) => {
      const runs = await repositories.verifications.listByFinding(
        organizationId,
        finding.id,
      );
      return Promise.all(
        runs.map(async (run) => ({
          ...run,
          checks: await repositories.verifications.listChecks(
            organizationId,
            run.id,
          ),
        })),
      );
    }),
  );
  return groups
    .flat()
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
}

export class ReportService {
  constructor(private readonly dependencies: ReportServiceDependencies) {}

  async createReport(input: CreateReportInput): Promise<Report> {
    return this.dependencies.unitOfWork.run(async (repositories) => {
      const company = await repositories.companies.getById(
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

      const rows = await listCompanyFindings(
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
        verificationHistory: await verificationHistory(
          repositories,
          input.organizationId,
          rows,
        ),
      };

      const now = this.dependencies.clock.now();
      const report: Report = {
        organizationId: input.organizationId,
        id: this.dependencies.idGenerator.next(),
        companyId: company.id,
        title: `${company.name} — ${periodLabel} Security Review`,
        periodLabel,
        status: "Ready",
        snapshot,
        generatedAt: now,
        createdAt: now,
      };
      await repositories.reports.insert(report);
      await repositories.auditEvents.append({
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
