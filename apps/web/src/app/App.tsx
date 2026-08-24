import {
  FileCheck2,
  FileText,
  FolderCheck,
  Gauge,
  Plug,
  RefreshCw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AppShell, type PageName } from "./AppShell";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { EvidencePage } from "../features/evidence/EvidencePage";
import { ImportFindingDialog } from "../features/imports/ImportFindingDialog";
import { RemediationPanel } from "../features/remediation/RemediationPanel";
import { ReportDialog } from "../features/reports/ReportDialog";
import { VerificationDrawer } from "../features/verification/VerificationDrawer";
import { useAuthentication } from "../features/auth/AuthenticationGate";
import {
  SeverityChip,
  StatusChip,
  type DashboardFinding,
  type FindingFilters,
  type FindingState,
  type QueueSort,
  type Severity,
} from "../features/findings/FindingQueue";
import {
  EmptyState,
  LoadingState,
  ProblemState,
} from "../features/shared/AsyncState";
import { api } from "../lib/api/client";
import { ApiProblemError, problemFromResponse } from "../lib/api/problems";
import type { components, operations } from "../lib/api/schema";
import { useApiQuery } from "../lib/api/useApiQuery";
import { useApiMutation } from "../lib/api/useApiMutation";
import { DialogLayer } from "../lib/dialogs/DialogLayer";
import { resolveFindingAction } from "../lib/findings/action";
import "../app.css";

type DashboardSnapshot = components["schemas"]["DashboardSnapshot"];
type FindingDetail = components["schemas"]["FindingDetail"];
type IntegrationState = components["schemas"]["IntegrationState"];
type DashboardQuery = NonNullable<
  operations["getDashboard"]["parameters"]["query"]
>;

const DEFAULT_FILTERS: FindingFilters = {
  search: "",
  companyId: "",
  state: "",
  severity: "",
  owner: "",
  sort: "priority",
};

const findingStates = new Set<FindingState>([
  "Needs remediation",
  "Remediating",
  "Awaiting verification",
  "Verification failed",
  "Verified fixed",
]);
const severities = new Set<Severity>([
  "Critical",
  "High",
  "Medium",
  "Low",
  "Info",
]);
const queueSorts = new Set<QueueSort>(["priority", "newest", "sla"]);

function validFindingState(value: string | null): "" | FindingState {
  return value && findingStates.has(value as FindingState)
    ? (value as FindingState)
    : "";
}

function validSeverity(value: string | null): "" | Severity {
  return value && severities.has(value as Severity) ? (value as Severity) : "";
}

function validSort(value: string | null): QueueSort {
  return value && queueSorts.has(value as QueueSort)
    ? (value as QueueSort)
    : "priority";
}

function filtersFromLocation(): FindingFilters {
  const parameters = new URLSearchParams(window.location.search);
  return {
    search: parameters.get("search") ?? "",
    owner: parameters.get("owner") ?? "",
    severity: validSeverity(parameters.get("severity")),
    state: validFindingState(parameters.get("state")),
    companyId: parameters.get("company_id") ?? parameters.get("company") ?? "",
    sort: validSort(parameters.get("sort")),
  };
}

function filtersUrl(filters: FindingFilters): string {
  const parameters = new URLSearchParams();
  if (filters.search.trim()) parameters.set("search", filters.search.trim());
  if (filters.owner) parameters.set("owner", filters.owner);
  if (filters.severity) parameters.set("severity", filters.severity);
  if (filters.state) parameters.set("state", filters.state);
  if (filters.companyId) parameters.set("company_id", filters.companyId);
  if (filters.sort !== "priority") parameters.set("sort", filters.sort);
  const search = parameters.toString();
  return `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
}

function dashboardQuery(filters: FindingFilters): DashboardQuery {
  return {
    ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
    ...(filters.companyId ? { company_id: filters.companyId } : {}),
    ...(filters.state ? { state: filters.state } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.owner ? { owner: filters.owner } : {}),
    sort: filters.sort,
    include_verified:
      filters.state === "Verified fixed" || Boolean(filters.search.trim()),
    page_size: 100,
  };
}

async function loadDashboard(
  filters: FindingFilters,
  signal: AbortSignal,
): Promise<DashboardSnapshot> {
  const { data, error, response } = await api.GET("/dashboard", {
    params: { query: dashboardQuery(filters) },
    signal,
  });
  if (data !== undefined) return data;
  throw new ApiProblemError(problemFromResponse(error, response));
}

async function loadFindingDetail(
  findingKey: string,
  signal: AbortSignal,
): Promise<FindingDetail> {
  const { data, error, response } = await api.GET("/findings/{findingId}", {
    params: { path: { findingId: findingKey } },
    signal,
  });
  if (data !== undefined) return data;
  throw new ApiProblemError(problemFromResponse(error, response));
}

async function loadIntegrations(
  signal: AbortSignal,
): Promise<IntegrationState[]> {
  const { data, error, response } = await api.GET("/integrations", { signal });
  if (data !== undefined) return data;
  throw new ApiProblemError(problemFromResponse(error, response));
}

function timestamp(value: string | null | undefined): string {
  if (!value) return "Not completed";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString();
}

export default function App() {
  const [page, setPage] = useState<PageName>("Dashboard");
  const [filters, setFilters] = useState<FindingFilters>(filtersFromLocation);
  const [activeFindingKey, setActiveFindingKey] = useState("");
  const [activeRemediationFinding, setActiveRemediationFinding] =
    useState<DashboardFinding | null>(null);
  const [activeVerificationFinding, setActiveVerificationFinding] =
    useState<DashboardFinding | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [mutationAnnouncement, setMutationAnnouncement] = useState("");
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const importTriggerRef = useRef<HTMLButtonElement | null>(null);

  const dashboard = useApiQuery<DashboardSnapshot>(
    (signal) => loadDashboard(filters, signal),
    [
      filters.search,
      filters.companyId,
      filters.state,
      filters.severity,
      filters.owner,
      filters.sort,
    ],
  );

  useEffect(() => {
    const handlePopState = () => setFilters(filtersFromLocation());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function updateFilters(
    nextFilters: FindingFilters,
    history: "replace" | "push" = "push",
  ) {
    setFilters(nextFilters);
    const url = filtersUrl(nextFilters);
    if (history === "replace") window.history.replaceState({}, "", url);
    else window.history.pushState({}, "", url);
  }

  function clearFilters() {
    updateFilters(DEFAULT_FILTERS, "push");
  }

  function openFinding(findingKey: string, trigger: HTMLButtonElement) {
    lastTriggerRef.current = trigger;
    setActiveFindingKey(findingKey);
  }

  function openReportDialog(trigger: HTMLButtonElement) {
    lastTriggerRef.current = trigger;
    setReportOpen(true);
  }

  function handleFindingAction(
    finding: DashboardFinding,
    trigger: HTMLButtonElement,
  ) {
    if (
      finding.state === "Needs remediation" ||
      finding.state === "Remediating" ||
      finding.state === "Verification failed"
    ) {
      lastTriggerRef.current = trigger;
      setActiveRemediationFinding(finding);
      return;
    }
    if (finding.state === "Awaiting verification") {
      lastTriggerRef.current = trigger;
      setActiveVerificationFinding(finding);
      return;
    }
    const action = resolveFindingAction(finding);
    if (action.kind === "finding" || action.kind === "verification") {
      openFinding(finding.finding_key, trigger);
      return;
    }
    setPage(action.page);
  }

  function applyMetric(label: string) {
    if (label === "Managed companies") {
      setPage("Companies");
      return;
    }
    if (label === "Awaiting verification") {
      updateFilters({ ...filters, state: "Awaiting verification" }, "push");
      return;
    }
    if (label === "Verification failed") {
      updateFilters({ ...filters, state: "Verification failed" }, "push");
      return;
    }
    if (label === "Verified fixed") {
      updateFilters({ ...filters, state: "Verified fixed" }, "push");
      return;
    }
    if (label === "SLA breaches") {
      updateFilters({ ...filters, state: "", sort: "sla" }, "push");
      return;
    }
    if (label === "Open findings") {
      updateFilters({ ...filters, state: "" }, "push");
    }
  }

  let content;
  if (
    (dashboard.status === "loading" || dashboard.status === "idle") &&
    !dashboard.data
  ) {
    content = <LoadingState />;
  } else if (dashboard.status === "error" && dashboard.problem) {
    content = (
      <ProblemState problem={dashboard.problem} onRetry={dashboard.reload} />
    );
  } else if (dashboard.data) {
    content = (
      <>
        <p
          className="refresh-state"
          role="status"
          aria-live="polite"
          hidden={dashboard.status !== "loading"}
        >
          Loading remediation workspace.
        </p>
        {page === "Dashboard" ? (
          <>
            <div className="workspace-primary-action">
              <button
                ref={importTriggerRef}
                type="button"
                className="button primary"
                onClick={() => setImportOpen(true)}
              >
                Import finding
              </button>
            </div>
            <DashboardPage
              key="dashboard-page"
              dashboard={dashboard.data}
              filters={filters}
              onMetric={applyMetric}
              onFiltersChange={updateFilters}
              onClearFilters={clearFilters}
              onFindingAction={handleFindingAction}
              onNavigate={setPage}
            />
          </>
        ) : (
          <SecondaryPage
            key={`secondary:${page}`}
            page={page}
            dashboard={dashboard.data}
            onNavigate={setPage}
            onOpenFinding={openFinding}
            onGenerateReport={openReportDialog}
          />
        )}
      </>
    );
  } else {
    content = <LoadingState />;
  }

  return (
    <>
      <AppShell
        page={page}
        search={filters.search}
        dashboard={dashboard.data}
        onNavigate={setPage}
        onSearch={(search) => updateFilters({ ...filters, search }, "replace")}
        onOpenFinding={openFinding}
      >
        {mutationAnnouncement ? (
          <p className="mutation-announcement" role="status" aria-live="polite">
            {mutationAnnouncement}
          </p>
        ) : null}
        {content}
      </AppShell>
      {activeFindingKey ? (
        <FindingDetailDrawer
          findingKey={activeFindingKey}
          restoreFocusRef={lastTriggerRef}
          onClose={() => setActiveFindingKey("")}
        />
      ) : null}
      {activeRemediationFinding ? (
        <RemediationPanel
          finding={activeRemediationFinding}
          restoreFocusRef={lastTriggerRef}
          onClose={() => setActiveRemediationFinding(null)}
          onPersistedChange={(message) => {
            setMutationAnnouncement(message);
            dashboard.reload();
          }}
        />
      ) : null}
      {activeVerificationFinding ? (
        <VerificationDrawer
          finding={activeVerificationFinding}
          restoreFocusRef={lastTriggerRef}
          onClose={() => setActiveVerificationFinding(null)}
          onPersistedChange={(message) => {
            setMutationAnnouncement(message);
            dashboard.reload();
          }}
        />
      ) : null}
      {reportOpen && dashboard.data ? (
        <ReportDialog
          companies={dashboard.data.companies}
          restoreFocusRef={lastTriggerRef}
          onClose={() => setReportOpen(false)}
          onSuccess={(report) => {
            setMutationAnnouncement(`Report ${report.id} generated.`);
            dashboard.reload();
          }}
        />
      ) : null}
      {importOpen && dashboard.data ? (
        <ImportFindingDialog
          companies={dashboard.data.companies}
          restoreFocusRef={importTriggerRef}
          onClose={() => setImportOpen(false)}
          onSuccess={(result) => {
            setMutationAnnouncement(`Imported ${result.finding.finding_key}.`);
            dashboard.reload();
          }}
        />
      ) : null}
    </>
  );
}

function FindingDetailDrawer({
  findingKey,
  restoreFocusRef,
  onClose,
}: {
  findingKey: string;
  restoreFocusRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const detail = useApiQuery<FindingDetail>(
    (signal) => loadFindingDetail(findingKey, signal),
    [findingKey],
  );

  return (
    <DialogLayer
      layerClassName="drawer-layer"
      dialogClassName="verification-drawer"
      labelledBy="finding-detail-title"
      initialFocusRef={closeRef}
      restoreFocusRef={restoreFocusRef}
      onClose={onClose}
    >
      <div className="drawer-header">
        <div>
          <span className="mono">{findingKey}</span>
          <h2 id="finding-detail-title">Finding detail</h2>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="icon-button"
          aria-label="Close finding detail"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="drawer-content">
        {detail.status === "loading" || detail.status === "idle" ? (
          <LoadingState />
        ) : detail.status === "error" && detail.problem ? (
          <ProblemState problem={detail.problem} onRetry={detail.reload} />
        ) : detail.data ? (
          <FindingDetailContent detail={detail.data} />
        ) : null}
      </div>
    </DialogLayer>
  );
}

function FindingDetailContent({ detail }: { detail: FindingDetail }) {
  return (
    <>
      <div className="drawer-finding">
        <SeverityChip severity={detail.finding.severity} />
        <h3>{detail.finding.title}</h3>
        <p>
          {detail.company.name} · {detail.finding.source}
        </p>
        <StatusChip state={detail.finding.state} />
      </div>

      <section aria-labelledby="remediation-history-title">
        <h3 id="remediation-history-title">Remediation history</h3>
        {detail.remediations.length ? (
          <div className="timeline">
            {detail.remediations.map((remediation, index) => (
              <div key={remediation.id}>
                <span>{index + 1}</span>
                <div>
                  <strong>{remediation.status}</strong>
                  <p>{remediation.summary}</p>
                  <p className="mono">{remediation.reference}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p>No remediation records are stored for this finding.</p>
        )}
      </section>

      <section aria-labelledby="verification-history-title">
        <h3 id="verification-history-title">Verification history</h3>
        {detail.verifications.length ? (
          <div className="simple-rows drawer-history">
            {detail.verifications.map(({ verification, checks }) => (
              <div key={verification.id}>
                <span className="mono">{verification.id}</span>
                <div>
                  <strong>{verification.status}</strong>
                  <small>
                    {verification.result_summary || verification.method}
                  </small>
                  <small>{checks.length} recorded checks</small>
                </div>
                <time dateTime={verification.completed_at ?? undefined}>
                  {timestamp(verification.completed_at)}
                </time>
              </div>
            ))}
          </div>
        ) : (
          <p>No verification runs are stored for this finding.</p>
        )}
      </section>

      <section aria-labelledby="finding-evidence-title">
        <h3 id="finding-evidence-title">Evidence</h3>
        {detail.evidence.length ? (
          <ul className="evidence-list">
            {detail.evidence.map((evidence) => (
              <li key={evidence.id}>
                <FileCheck2 aria-hidden="true" />
                <span>
                  {evidence.label}
                  <small className="mono">{evidence.content_hash}</small>
                </span>
                <span>{evidence.locked_at ? "Locked" : "Recorded"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No evidence is stored for this finding yet.</p>
        )}
      </section>
    </>
  );
}

function SecondaryPage({
  page,
  dashboard,
  onNavigate,
  onOpenFinding,
  onGenerateReport,
}: {
  page: PageName;
  dashboard: DashboardSnapshot;
  onNavigate: (page: PageName) => void;
  onOpenFinding: (findingKey: string, trigger: HTMLButtonElement) => void;
  onGenerateReport: (trigger: HTMLButtonElement) => void;
}) {
  const authentication = useAuthentication();

  if (page === "Companies") {
    return (
      <ScaffoldPage
        title="Companies"
        copy="Track persisted customer risk, open findings, and verification pressure."
      >
        <div className="company-list page-list">
          {dashboard.companies.map((company) => (
            <button
              type="button"
              key={company.company_id}
              onClick={() => onNavigate("Findings")}
            >
              <span className="company-name">{company.company_name}</span>
              <span>
                Risk <strong>{company.risk_score}</strong> {company.risk_level}
              </span>
              <span>{company.open_findings} open</span>
              <span>{company.awaiting_verification} awaiting verification</span>
              <span>{company.verification_failed} failed</span>
            </button>
          ))}
        </div>
      </ScaffoldPage>
    );
  }

  if (page === "Findings") {
    return (
      <ScaffoldPage
        title="Findings"
        copy="Finding rows are read from the canonical local API with the active URL filters."
      >
        {dashboard.action_queue.length ? (
          <div className="simple-rows">
            {dashboard.action_queue.map((finding) => (
              <div key={finding.id}>
                <span className="mono">{finding.finding_key}</span>
                <div>
                  <strong>{finding.title}</strong>
                  <small>
                    {finding.company_name} · {finding.source}
                  </small>
                </div>
                <button
                  type="button"
                  className="row-action"
                  onClick={(event) =>
                    onOpenFinding(finding.finding_key, event.currentTarget)
                  }
                >
                  View details
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No findings match the current URL filters."
            detail="Return to Dashboard to change or clear the queue filters."
          />
        )}
      </ScaffoldPage>
    );
  }

  if (page === "Remediation") {
    return (
      <ScaffoldPage
        title="Remediation"
        copy="Read persisted remediation pressure without changing workflow state from the browser."
      >
        {dashboard.action_queue.length ? (
          <div className="simple-rows">
            {dashboard.action_queue.map((finding) => (
              <div key={finding.id}>
                <span className="mono">{finding.finding_key}</span>
                <div>
                  <strong>{finding.title}</strong>
                  <small>{finding.company_name}</small>
                </div>
                <StatusChip state={finding.state} />
              </div>
            ))}
          </div>
        ) : (
          <p className="workspace-search-empty">
            No remediation work matches the active filters.
          </p>
        )}
      </ScaffoldPage>
    );
  }

  if (page === "Verification") {
    return (
      <ScaffoldPage
        title="Verification"
        copy="Verification activity is a persisted control path separate from remediation."
      >
        {dashboard.verification_activity.length ? (
          <div className="simple-rows">
            {dashboard.verification_activity.map((activity) => (
              <div key={activity.verification_id}>
                <span className="mono">{activity.finding_key}</span>
                <div>
                  <strong>{activity.status}</strong>
                  <small>
                    {activity.result_summary || activity.company_name}
                  </small>
                </div>
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
      </ScaffoldPage>
    );
  }

  if (page === "Evidence") return <EvidencePage />;

  if (page === "Reports") {
    const report = dashboard.latest_report;
    return (
      <ScaffoldPage
        title="Reports"
        copy="Client reporting reflects immutable persisted report snapshots."
      >
        <div className="report-page-actions">
          <button
            type="button"
            className="button primary"
            onClick={(event) => onGenerateReport(event.currentTarget)}
          >
            Generate report
          </button>
        </div>
        {report ? (
          <div className="report-status page-report">
            <div>
              <p className="section-kicker">{report.snapshot.company_name}</p>
              <h2>{report.title}</h2>
              <p>
                Risk score <strong>{report.snapshot.risk_score}</strong> ·
                Critical findings{" "}
                <strong>{report.snapshot.critical_findings}</strong> · High
                findings <strong>{report.snapshot.high_findings}</strong> ·
                Verified fixes <strong>{report.snapshot.verified_fixes}</strong>{" "}
                · SLA compliance{" "}
                <strong>{report.snapshot.sla_compliance_percent}%</strong>
              </p>
              <p className="report-metadata">
                Snapshot <span className="mono">{report.id}</span> ·{" "}
                {report.period_label}
              </p>
              <a
                className="button secondary"
                href={`/api/v1/reports/${encodeURIComponent(report.id)}/download`}
              >
                Download Markdown
              </a>
            </div>
            <span className="locked-state">{report.status}</span>
          </div>
        ) : (
          <EmptyState
            title="No report snapshot yet."
            detail="Generate a report to create a new immutable persisted snapshot."
          />
        )}
      </ScaffoldPage>
    );
  }

  if (page === "Integrations") return <IntegrationsPage />;

  if (page === "Settings") {
    return (
      <ScaffoldPage
        title="Settings"
        copy="Workspace controls describe the current local security and verification boundary."
      >
        <div className="setting-list">
          <div>
            <SlidersHorizontal aria-hidden="true" />
            <div>
              <strong>Verification policy</strong>
              <p>
                Require an independent pass before a finding can reach Verified
                fixed.
              </p>
            </div>
            <span>Required</span>
          </div>
          <div>
            <FolderCheck aria-hidden="true" />
            <div>
              <strong>Evidence retention</strong>
              <p>
                Keep failed verification history and locked evidence with
                closure records.
              </p>
            </div>
            <span>Enabled</span>
          </div>
          <div>
            <RefreshCw aria-hidden="true" />
            <div>
              <strong>API boundary</strong>
              <p>Browser reads use the same-origin local API under /api/v1.</p>
            </div>
            <span>Local</span>
          </div>
        </div>
      </ScaffoldPage>
    );
  }

  if (page === "Help") {
    return (
      <ScaffoldPage
        title="Help"
        copy="Use the public architecture documentation and canonical OpenAPI contract."
      >
        <div className="resource-actions">
          <a
            className="button secondary"
            href="https://github.com/remedence/remedence/tree/main/docs"
            target="_blank"
            rel="noreferrer"
          >
            <FileText aria-hidden="true" />
            Read architecture docs
          </a>
          <a
            className="button secondary"
            href="https://github.com/remedence/remedence/blob/main/api/openapi.yaml"
            target="_blank"
            rel="noreferrer"
          >
            <Gauge aria-hidden="true" />
            View OpenAPI contract
          </a>
        </div>
      </ScaffoldPage>
    );
  }

  return (
    <ScaffoldPage
      title="Account"
      copy="Current local workspace identity and organization context."
    >
      <div className="account-panel">
        <div className="account-avatar">
          {authentication.user
            ? authentication.user.name
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0]?.toLocaleUpperCase("en-US"))
                .join("")
            : "HO"}
        </div>
        <div>
          <h2>{authentication.user?.name ?? "Harborline Operator"}</h2>
          <p>
            {authentication.user?.email ??
              "Harborline Technology Group · Local workspace operator"}
          </p>
          {authentication.mode === "required" ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => void authentication.signOut()}
            >
              Sign out
            </button>
          ) : (
            <small>
              Local v1 does not claim a connected production identity provider.
            </small>
          )}
        </div>
      </div>
    </ScaffoldPage>
  );
}

function IntegrationsPage() {
  const integrations = useApiQuery<IntegrationState[]>(
    (signal) => loadIntegrations(signal),
    [],
  );
  const [provider, setProvider] =
    useState<IntegrationState["provider"]>("generic-webhook");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [secret, setSecret] = useState("");
  const create = useApiMutation<
    operations["createIntegration"]["requestBody"]["content"]["application/json"],
    IntegrationState
  >(async (body, signal) => {
    const { data, error, response } = await api.POST("/integrations", {
      body,
      signal,
    });
    if (data !== undefined) return data;
    throw new ApiProblemError(problemFromResponse(error, response));
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const configuration =
      provider === "generic-webhook"
        ? { url: target.trim() }
        : provider === "github-issues"
          ? { repository: target.trim() }
          : {};
    const credentials: Record<string, string> =
      provider === "generic-webhook"
        ? { signing_secret: secret }
        : provider === "github-issues"
          ? { token: secret }
          : { webhook_secret: secret };
    const result = await create.mutate({
      provider,
      name: name.trim(),
      configuration,
      credentials,
    });
    if (!result) return;
    setName("");
    setTarget("");
    setSecret("");
    integrations.reload();
  }
  return (
    <ScaffoldPage
      title="Integrations"
      copy="Configure encrypted provider connections and inspect their operational state."
    >
      <form className="workflow-form" onSubmit={(event) => void submit(event)}>
        <label>
          <span>Provider</span>
          <select
            aria-label="Integration provider"
            value={provider}
            onChange={(event) =>
              setProvider(event.target.value as IntegrationState["provider"])
            }
          >
            <option value="generic-webhook">Signed HTTPS webhook</option>
            <option value="github-issues">GitHub issues</option>
            <option value="scanner-webhook">Inbound scanner webhook</option>
          </select>
        </label>
        <label>
          <span>Connection name</span>
          <input
            name="integrationName"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {provider !== "scanner-webhook" ? (
          <label>
            <span>
              {provider === "github-issues"
                ? "Repository (owner/name)"
                : "HTTPS endpoint"}
            </span>
            <input
              name="integrationTarget"
              required
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />
          </label>
        ) : null}
        <label>
          <span>
            {provider === "github-issues" ? "Access token" : "Signing secret"}
          </span>
          <input
            name="integrationSecret"
            type="password"
            minLength={provider === "github-issues" ? 20 : 32}
            required
            autoComplete="new-password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
        </label>
        {create.status === "error" && create.problem ? (
          <ProblemState problem={create.problem} onRetry={create.reset} />
        ) : null}
        <button
          className="button primary"
          type="submit"
          disabled={create.status === "pending"}
        >
          {create.status === "pending" ? "Saving…" : "Add integration"}
        </button>
      </form>
      {integrations.status === "loading" || integrations.status === "idle" ? (
        <LoadingState />
      ) : integrations.status === "error" && integrations.problem ? (
        <ProblemState
          problem={integrations.problem}
          onRetry={integrations.reload}
        />
      ) : integrations.data?.length ? (
        <div className="integration-list">
          {integrations.data.map((integration) => (
            <div key={integration.id}>
              <Plug aria-hidden="true" />
              <div>
                <strong>{integration.name}</strong>
                <small>{integration.provider} · credentials encrypted</small>
              </div>
              <span>{integration.status}</span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No integrations are registered."
          detail="The local API did not return any integration capability records."
        />
      )}
    </ScaffoldPage>
  );
}

function ScaffoldPage({
  title,
  copy,
  children,
}: {
  title: string;
  copy: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="page-header compact">
        <div>
          <h1>{title}</h1>
          <p>{copy}</p>
        </div>
      </div>
      <section className="operational-section scaffold-section">
        {children}
      </section>
    </>
  );
}
