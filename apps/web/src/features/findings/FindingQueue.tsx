import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { components } from "../../lib/api/schema";
import { EmptyState } from "../shared/AsyncState";

export type DashboardFinding = components["schemas"]["DashboardFinding"];
export type CompanyRiskSummary = components["schemas"]["CompanyRiskSummary"];
export type FindingState = components["schemas"]["FindingState"];
export type Severity = components["schemas"]["Severity"];
export type QueueSort = components["parameters"]["SortQuery"];

export interface FindingFilters {
  search: string;
  companyId: string;
  state: "" | FindingState;
  severity: "" | Severity;
  owner: string;
  sort: QueueSort;
}

const allStates: FindingState[] = [
  "Verification failed",
  "Awaiting verification",
  "Needs remediation",
  "Remediating",
  "Verified fixed",
];

const allSeverities: Severity[] = ["Critical", "High", "Medium", "Low", "Info"];

export function StatusChip({ state }: { state: FindingState }) {
  const icon =
    state === "Verification failed" ? (
      <AlertCircle aria-hidden="true" />
    ) : state === "Verified fixed" ? (
      <CheckCircle2 aria-hidden="true" />
    ) : state === "Awaiting verification" ? (
      <ShieldCheck aria-hidden="true" />
    ) : (
      <Wrench aria-hidden="true" />
    );

  return (
    <span
      className={`status-chip status-${state.toLowerCase().replaceAll(" ", "-")}`}
    >
      {icon}
      {state}
    </span>
  );
}

export function SeverityChip({ severity }: { severity: Severity }) {
  return (
    <span className={`severity severity-${severity.toLowerCase()}`}>
      <AlertTriangle aria-hidden="true" />
      {severity}
    </span>
  );
}

export function findingActionLabel(finding: DashboardFinding): string {
  switch (finding.state) {
    case "Verification failed":
      return "Start new remediation";
    case "Awaiting verification":
      return "Review verification";
    case "Needs remediation":
      return "Start remediation";
    case "Remediating":
      return "View remediation";
    case "Verified fixed":
      return "View evidence";
  }
}

function detectedLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function FindingQueue({
  findings,
  companies,
  filters,
  onFiltersChange,
  onClearFilters,
  onFindingAction,
}: {
  findings: DashboardFinding[];
  companies: CompanyRiskSummary[];
  filters: FindingFilters;
  onFiltersChange: (
    filters: FindingFilters,
    history: "replace" | "push",
  ) => void;
  onClearFilters: () => void;
  onFindingAction: (
    finding: DashboardFinding,
    trigger: HTMLButtonElement,
  ) => void;
}) {
  const [expandedFinding, setExpandedFinding] = useState("");
  const owners = useMemo(() => {
    const values = new Set(
      findings.map((finding) => finding.owner).filter(Boolean),
    );
    if (filters.owner) values.add(filters.owner);
    return [...values].sort((left, right) => left.localeCompare(right));
  }, [filters.owner, findings]);

  function update(
    patch: Partial<FindingFilters>,
    history: "replace" | "push" = "push",
  ) {
    onFiltersChange({ ...filters, ...patch }, history);
  }

  const filterControls = (
    <>
      <label>
        <span>Company</span>
        <select
          name="findingCompanyFilter"
          value={filters.companyId}
          onChange={(event) => update({ companyId: event.target.value })}
        >
          <option value="">All companies</option>
          {companies.map((company) => (
            <option key={company.company_id} value={company.company_id}>
              {company.company_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>State</span>
        <select
          name="state"
          value={filters.state}
          onChange={(event) =>
            update({ state: event.target.value as "" | FindingState })
          }
        >
          <option value="">All states</option>
          {allStates.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Severity</span>
        <select
          name="severity"
          value={filters.severity}
          onChange={(event) =>
            update({ severity: event.target.value as "" | Severity })
          }
        >
          <option value="">All severities</option>
          {allSeverities.map((severity) => (
            <option key={severity} value={severity}>
              {severity}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Owner</span>
        <select
          name="owner"
          value={filters.owner}
          onChange={(event) => update({ owner: event.target.value })}
        >
          <option value="">All owners</option>
          {owners.map((owner) => (
            <option key={owner} value={owner}>
              {owner}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Sort</span>
        <select
          name="sort"
          value={filters.sort}
          onChange={(event) =>
            update({ sort: event.target.value as QueueSort })
          }
        >
          <option value="priority">Priority</option>
          <option value="newest">Newest</option>
          <option value="sla">SLA</option>
        </select>
      </label>
    </>
  );

  return (
    <section
      className="operational-section action-queue"
      aria-labelledby="action-queue-title"
    >
      <div className="section-title-row">
        <div>
          <h2 id="action-queue-title">Action queue</h2>
          <p>Failed verification and critical work appear first.</p>
        </div>
        <span className="queue-count">{findings.length} shown</span>
      </div>

      <div className="queue-toolbar" aria-label="Action queue filters">
        <label className="filter-search">
          <span>Search findings</span>
          <div>
            <Search aria-hidden="true" />
            <input
              type="search"
              name="finding-search"
              value={filters.search}
              onChange={(event) =>
                update({ search: event.target.value }, "replace")
              }
              placeholder="SEC-1042 or patient-export"
            />
          </div>
        </label>
        {filterControls}
      </div>

      <details className="mobile-filter-details">
        <summary>
          <SlidersHorizontal aria-hidden="true" />
          Filters and sort
        </summary>
        <div className="mobile-filter-grid">{filterControls}</div>
      </details>

      {findings.length ? (
        <>
          <div className="queue-table-wrap">
            <table className="queue-table">
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Finding</th>
                  <th scope="col">Severity</th>
                  <th scope="col">State</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Detected / SLA</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((finding) => {
                  const expanded = expandedFinding === finding.finding_key;
                  return (
                    <QueueRows
                      key={finding.id}
                      finding={finding}
                      expanded={expanded}
                      onExpand={() =>
                        setExpandedFinding(expanded ? "" : finding.finding_key)
                      }
                      onAction={onFindingAction}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mobile-queue" aria-label="Action queue">
            {findings.map((finding) => {
              const expanded = expandedFinding === finding.finding_key;
              return (
                <article key={finding.id} className="mobile-finding-row">
                  <div className="mobile-finding-top">
                    <span className="mono">{finding.finding_key}</span>
                    <SeverityChip severity={finding.severity} />
                  </div>
                  <button
                    type="button"
                    className="title-button"
                    aria-expanded={expanded}
                    onClick={() =>
                      setExpandedFinding(expanded ? "" : finding.finding_key)
                    }
                  >
                    {finding.title}
                  </button>
                  <p>{finding.company_name}</p>
                  <StatusChip state={finding.state} />
                  {expanded && finding.state === "Verification failed" ? (
                    <p className="failure-summary">
                      <AlertCircle aria-hidden="true" />
                      Independent verification failed. Open the persisted
                      finding history for details.
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className="row-action"
                    onClick={(event) =>
                      onFindingAction(finding, event.currentTarget)
                    }
                  >
                    {findingActionLabel(finding)}
                  </button>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <EmptyState
          title="No findings match these filters."
          detail="Clear one or more filters to return findings to the action queue."
          action={
            <button
              type="button"
              className="button secondary"
              onClick={onClearFilters}
            >
              Clear filters
            </button>
          }
        />
      )}
    </section>
  );
}

function QueueRows({
  finding,
  expanded,
  onExpand,
  onAction,
}: {
  finding: DashboardFinding;
  expanded: boolean;
  onExpand: () => void;
  onAction: (finding: DashboardFinding, trigger: HTMLButtonElement) => void;
}) {
  return (
    <>
      <tr
        className={
          finding.state === "Verification failed" ? "failed-row" : undefined
        }
      >
        <td>{finding.company_name}</td>
        <td>
          <span className="mono finding-id">{finding.finding_key}</span>
          <button
            type="button"
            className="title-button"
            aria-expanded={expanded}
            onClick={onExpand}
          >
            {finding.title}
          </button>
          <small>{finding.source}</small>
        </td>
        <td>
          <SeverityChip severity={finding.severity} />
        </td>
        <td>
          <StatusChip state={finding.state} />
        </td>
        <td>{finding.owner}</td>
        <td>
          <time dateTime={finding.detected_at}>
            {detectedLabel(finding.detected_at)}
          </time>
          {finding.sla_breached ? (
            <span className="sla-text">
              <AlertTriangle aria-hidden="true" />
              SLA breached
            </span>
          ) : null}
        </td>
        <td>
          <button
            type="button"
            className="row-action"
            onClick={(event) => onAction(finding, event.currentTarget)}
          >
            {findingActionLabel(finding)}
          </button>
        </td>
      </tr>
      {expanded && finding.state === "Verification failed" ? (
        <tr className="expanded-row">
          <td colSpan={7}>
            <div>
              <AlertCircle aria-hidden="true" />
              <strong>Independent verification failed.</strong>
              <span>
                Open the finding to review the persisted verification result and
                checks.
              </span>
              <span>
                A later pass does not remove failed verification history.
              </span>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
