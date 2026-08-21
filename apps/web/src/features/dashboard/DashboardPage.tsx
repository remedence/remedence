import { FileText } from "lucide-react";
import type { components } from "../../lib/api/schema";
import {
  FindingQueue,
  type DashboardFinding,
  type FindingFilters,
} from "../findings/FindingQueue";
import type { PageName } from "../../app/AppShell";

type DashboardSnapshot = components["schemas"]["DashboardSnapshot"];

const metricKeys = [
  ["Managed companies", "managed_companies"],
  ["Open findings", "open_findings"],
  ["Awaiting verification", "awaiting_verification"],
  ["Verification failed", "verification_failed"],
  ["Verified fixed", "verified_fixed"],
  ["SLA breaches", "sla_breaches"],
] as const;

function timestamp(value: string | null): string {
  if (!value) return "In progress";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString();
}

export function DashboardPage({
  dashboard,
  filters,
  onMetric,
  onFiltersChange,
  onClearFilters,
  onFindingAction,
  onNavigate,
}: {
  dashboard: DashboardSnapshot;
  filters: FindingFilters;
  onMetric: (label: string) => void;
  onFiltersChange: (
    filters: FindingFilters,
    history: "replace" | "push",
  ) => void;
  onClearFilters: () => void;
  onFindingAction: (
    finding: DashboardFinding,
    trigger: HTMLButtonElement,
  ) => void;
  onNavigate: (page: PageName) => void;
}) {
  const report = dashboard.latest_report;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>
            Review persisted findings that need remediation or verification.
          </p>
        </div>
      </div>

      <section className="metric-strip" aria-label="Workspace metrics">
        {metricKeys.map(([label, key]) => (
          <button
            key={key}
            type="button"
            aria-label={`${label} ${dashboard.metrics[key]}`}
            onClick={() => onMetric(label)}
          >
            <span>{label}</span>
            <strong>{dashboard.metrics[key]}</strong>
          </button>
        ))}
      </section>

      <FindingQueue
        findings={dashboard.action_queue}
        companies={dashboard.companies}
        filters={filters}
        onFiltersChange={onFiltersChange}
        onClearFilters={onClearFilters}
        onFindingAction={onFindingAction}
      />

      <div className="dashboard-lower-grid">
        <section className="operational-section" aria-labelledby="risk-title">
          <div className="section-title-row">
            <div>
              <h2 id="risk-title">Company risk overview</h2>
              <p>Customer risk and verification pressure from the local API.</p>
            </div>
          </div>
          <div className="company-list">
            {dashboard.companies.map((company) => (
              <button
                key={company.company_id}
                type="button"
                onClick={() => onNavigate("Companies")}
              >
                <span className="company-name">{company.company_name}</span>
                <span>
                  Risk <strong>{company.risk_score}</strong>{" "}
                  {company.risk_level}
                </span>
                <span>{company.open_findings} open</span>
                <span>
                  {company.awaiting_verification} awaiting verification
                </span>
                <span>{company.verification_failed} failed</span>
              </button>
            ))}
          </div>
        </section>

        <section
          className="operational-section"
          aria-labelledby="activity-title"
        >
          <div className="section-title-row">
            <div>
              <h2 id="activity-title">Recent verification activity</h2>
              <p>Latest persisted independent verification outcomes.</p>
            </div>
          </div>
          {dashboard.verification_activity.length ? (
            <div className="activity-list">
              {dashboard.verification_activity.map((activity) => (
                <div key={activity.verification_id}>
                  <span className="mono">{activity.finding_key}</span>
                  <strong>{activity.status}</strong>
                  <span>
                    {activity.result_summary || activity.company_name}
                  </span>
                  <time dateTime={activity.completed_at ?? undefined}>
                    {timestamp(activity.completed_at)}
                  </time>
                </div>
              ))}
            </div>
          ) : (
            <p className="workspace-search-empty">
              No verification activity is recorded yet.
            </p>
          )}
        </section>
      </div>

      <section className="report-status" aria-labelledby="report-status-title">
        {report ? (
          <>
            <div>
              <p className="section-kicker">
                Latest client report · {report.snapshot.company_name}
              </p>
              <h2 id="report-status-title">{report.title}</h2>
              <p>
                Risk score <strong>{report.snapshot.risk_score}</strong> ·
                Verified fixes <strong>{report.snapshot.verified_fixes}</strong>{" "}
                · SLA compliance{" "}
                <strong>{report.snapshot.sla_compliance_percent}%</strong>
              </p>
            </div>
            <div className="report-meta">
              <span>
                {report.status} · {timestamp(report.generated_at)}
              </span>
              <button
                type="button"
                className="button secondary"
                onClick={() => onNavigate("Reports")}
              >
                <FileText aria-hidden="true" />
                View report
              </button>
            </div>
          </>
        ) : (
          <div>
            <p className="section-kicker">Latest client report</p>
            <h2 id="report-status-title">No report snapshot yet</h2>
            <p>
              Generate a report through the persisted report workflow when it
              becomes available.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
