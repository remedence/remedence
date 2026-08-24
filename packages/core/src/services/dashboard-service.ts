import type {
  CompanyRiskSummary,
  NotificationItem,
  Report,
  VerificationActivity,
} from "../domain/entities.js";
import type {
  DashboardFinding,
  FindingQuery,
  RepositorySet,
} from "../ports/repositories.js";

export interface DashboardMetrics {
  managedCompanies: number;
  openFindings: number;
  awaitingVerification: number;
  verificationFailed: number;
  verifiedFixed: number;
  slaBreaches: number;
}

export interface DashboardSnapshot {
  metrics: DashboardMetrics;
  actionQueue: DashboardFinding[];
  companies: CompanyRiskSummary[];
  verificationActivity: VerificationActivity[];
  notifications: NotificationItem[];
  latestReport?: Report;
}

export interface DashboardServiceDependencies {
  repositories: RepositorySet;
}

async function listAllFindings(
  repositories: RepositorySet,
  organizationId: string,
): Promise<DashboardFinding[]> {
  const pageSize = 100;
  const items: DashboardFinding[] = [];
  let cursor: string | undefined;

  do {
    const result = await repositories.findings.list({
      organizationId,
      sort: "priority",
      includeVerified: true,
      pageSize,
      ...(cursor ? { cursor } : {}),
    });
    items.push(...result.items);
    cursor = result.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

async function latestReport(
  repositories: RepositorySet,
  organizationId: string,
  companyIds: string[],
): Promise<Report | undefined> {
  return (
    await Promise.all(
      companyIds.map((companyId) =>
        repositories.reports.listByCompany(organizationId, companyId),
      ),
    )
  )
    .flat()
    .sort(
      (left, right) =>
        right.generatedAt.localeCompare(left.generatedAt) ||
        right.id.localeCompare(left.id),
    )[0];
}

export class DashboardService {
  constructor(private readonly dependencies: DashboardServiceDependencies) {}

  async getDashboard(query: FindingQuery): Promise<DashboardSnapshot> {
    const repositories = this.dependencies.repositories;
    const [companies, allFindings, actionQueuePage] = await Promise.all([
      repositories.companies.list(query.organizationId),
      listAllFindings(repositories, query.organizationId),
      repositories.findings.list(query),
    ]);
    const actionQueue = actionQueuePage.items;

    const metrics: DashboardMetrics = {
      managedCompanies: companies.length,
      openFindings: allFindings.filter(
        (finding) => finding.state !== "Verified fixed",
      ).length,
      awaitingVerification: allFindings.filter(
        (finding) => finding.state === "Awaiting verification",
      ).length,
      verificationFailed: allFindings.filter(
        (finding) => finding.state === "Verification failed",
      ).length,
      verifiedFixed: allFindings.filter(
        (finding) => finding.state === "Verified fixed",
      ).length,
      slaBreaches: allFindings.filter((finding) => finding.slaBreached).length,
    };

    const companySummaries: CompanyRiskSummary[] = companies.map((company) => {
      const rows = allFindings.filter(
        (finding) => finding.companyId === company.id,
      );
      return {
        companyId: company.id,
        companyName: company.name,
        riskScore: company.riskScore,
        riskLevel: company.riskLevel,
        openFindings: rows.filter(
          (finding) => finding.state !== "Verified fixed",
        ).length,
        awaitingVerification: rows.filter(
          (finding) => finding.state === "Awaiting verification",
        ).length,
        verificationFailed: rows.filter(
          (finding) => finding.state === "Verification failed",
        ).length,
      };
    });

    const companyNames = new Map(
      companies.map((company) => [company.id, company.name] as const),
    );
    const verificationActivity: VerificationActivity[] = (
      await Promise.all(
        allFindings.map(async (finding) =>
          (
            await repositories.verifications.listByFinding(
              query.organizationId,
              finding.id,
            )
          ).map((run) => ({
            verificationId: run.id,
            findingKey: finding.findingKey,
            companyName:
              companyNames.get(finding.companyId) ?? "Unknown company",
            status: run.status,
            resultSummary: run.resultSummary,
            completedAt: run.completedAt,
            sortAt: run.completedAt ?? run.createdAt,
          })),
        ),
      )
    )
      .flat()
      .sort(
        (left, right) =>
          right.sortAt.localeCompare(left.sortAt) ||
          right.verificationId.localeCompare(left.verificationId),
      )
      .map(({ sortAt: _sortAt, ...activity }) => activity)
      .slice(0, 25);

    const notifications: NotificationItem[] = [];
    if (metrics.verificationFailed > 0) {
      notifications.push({
        id: "verification-failed",
        status: "attention",
        message: `${metrics.verificationFailed} finding${
          metrics.verificationFailed === 1 ? " has" : "s have"
        } failed verification.`,
      });
    }
    if (metrics.slaBreaches > 0) {
      notifications.push({
        id: "sla-breaches",
        status: "attention",
        message: `${metrics.slaBreaches} finding${
          metrics.slaBreaches === 1 ? " is" : "s are"
        } past remediation SLA.`,
      });
    }

    const report = await latestReport(
      repositories,
      query.organizationId,
      companies.map((company) => company.id),
    );

    return {
      metrics,
      actionQueue,
      companies: companySummaries,
      verificationActivity,
      notifications,
      ...(report ? { latestReport: report } : {}),
    };
  }
}
