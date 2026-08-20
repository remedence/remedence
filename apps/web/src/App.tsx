import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  FileCheck2,
  FileDown,
  FileText,
  FolderCheck,
  Gauge,
  Import,
  LayoutDashboard,
  LifeBuoy,
  Menu,
  Plug,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UserCircle,
  Wrench,
  X,
} from "lucide-react";
import {
  companyRisk,
  evidenceItems,
  findings as seedFindings,
  Finding,
  FindingState,
  verificationActivity,
} from "./data";
import "./app.css";

type PageName =
  | "Dashboard"
  | "Companies"
  | "Findings"
  | "Remediation"
  | "Verification"
  | "Evidence"
  | "Reports"
  | "Integrations"
  | "Settings"
  | "Help"
  | "Account";

type Overlay = "import" | "report" | null;

const primaryNav = [
  { label: "Dashboard" as PageName, icon: LayoutDashboard },
  { label: "Companies" as PageName, icon: Building2 },
  { label: "Findings" as PageName, icon: AlertCircle },
  { label: "Remediation" as PageName, icon: Wrench },
  { label: "Verification" as PageName, icon: ShieldCheck, count: 8 },
  { label: "Evidence" as PageName, icon: FolderCheck },
  { label: "Reports" as PageName, icon: FileText },
  { label: "Integrations" as PageName, icon: Plug },
];

const secondaryNav = [
  { label: "Settings" as PageName, icon: Settings },
  { label: "Help" as PageName, icon: LifeBuoy },
  { label: "Account" as PageName, icon: UserCircle },
];

const allStates: Array<FindingState | "All states"> = [
  "All states",
  "Verification failed",
  "Awaiting verification",
  "Needs remediation",
  "Remediating",
  "Verified fixed",
];

function StatusChip({ state }: { state: FindingState }) {
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

function SeverityChip({ severity }: { severity: Finding["severity"] }) {
  return (
    <span className={`severity severity-${severity.toLowerCase()}`}>
      <AlertTriangle aria-hidden="true" />
      {severity}
    </span>
  );
}

function App() {
  const [page, setPage] = useState<PageName>("Dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [activeFinding, setActiveFinding] = useState<Finding | null>(null);
  const [expandedFinding, setExpandedFinding] = useState<string>("SEC-1042");
  const [findings, setFindings] = useState(seedFindings);
  const [query, setQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("All companies");
  const [stateFilter, setStateFilter] = useState<FindingState | "All states">(
    "All states",
  );
  const [severityFilter, setSeverityFilter] = useState("All severities");
  const [verificationPassed, setVerificationPassed] = useState(false);
  const [reportReady, setReportReady] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);
  const modalCloseRef = useRef<HTMLButtonElement | null>(null);

  const effectiveFindings = useMemo(
    () =>
      findings.map((finding) =>
        finding.id === "SEC-1042" && verificationPassed
          ? {
              ...finding,
              state: "Verified fixed" as FindingState,
              action: "View evidence",
            }
          : finding,
      ),
    [findings, verificationPassed],
  );

  const filteredFindings = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return effectiveFindings.filter((finding) => {
      const matchesQuery =
        !normalized ||
        [
          finding.id,
          finding.title,
          finding.company,
          finding.owner,
          finding.source,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      const matchesCompany =
        companyFilter === "All companies" || finding.company === companyFilter;
      const matchesState =
        stateFilter === "All states" || finding.state === stateFilter;
      const matchesSeverity =
        severityFilter === "All severities" ||
        finding.severity === severityFilter;
      return matchesQuery && matchesCompany && matchesState && matchesSeverity;
    });
  }, [effectiveFindings, query, companyFilter, stateFilter, severityFilter]);

  function navigate(nextPage: PageName) {
    setPage(nextPage);
    setMobileNavOpen(false);
    setNotificationsOpen(false);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function openFinding(finding: Finding, trigger: HTMLButtonElement) {
    lastTriggerRef.current = trigger;
    setActiveFinding(finding);
  }

  function closeFinding() {
    setActiveFinding(null);
    requestAnimationFrame(() => lastTriggerRef.current?.focus());
  }

  function openOverlay(
    nextOverlay: Exclude<Overlay, null>,
    trigger: HTMLButtonElement,
  ) {
    lastTriggerRef.current = trigger;
    setOverlay(nextOverlay);
  }

  function closeOverlay() {
    setOverlay(null);
    requestAnimationFrame(() => lastTriggerRef.current?.focus());
  }

  useEffect(() => {
    if (activeFinding) drawerCloseRef.current?.focus();
  }, [activeFinding]);

  useEffect(() => {
    if (overlay) modalCloseRef.current?.focus();
  }, [overlay]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (activeFinding) closeFinding();
      else if (overlay) closeOverlay();
      else if (mobileNavOpen) setMobileNavOpen(false);
      else if (notificationsOpen) setNotificationsOpen(false);
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  });

  function applyMetricFilter(label: string) {
    if (label === "Open findings") setStateFilter("All states");
    if (label === "Awaiting verification")
      setStateFilter("Awaiting verification");
    if (label === "Verification failed") setStateFilter("Verification failed");
    if (label === "Verified fixed") setStateFilter("Verified fixed");
    if (label === "Managed companies") navigate("Companies");
    if (label === "SLA breaches") {
      setQuery("SEC-1058");
      setStateFilter("All states");
    }
  }

  function runVerification() {
    setVerificationPassed(true);
    setLiveMessage("Verified fixed. Evidence bundle locked.");
  }

  function addImportedFinding(imported: Finding) {
    setFindings((current) => [imported, ...current]);
    setLiveMessage(`${imported.id} imported into the local demo queue.`);
    setQuery(imported.id);
    setStateFilter("All states");
    setPage("Dashboard");
  }

  const metrics = [
    { label: "Managed companies", value: 12 },
    { label: "Open findings", value: verificationPassed ? 46 : 47 },
    { label: "Awaiting verification", value: 8 },
    { label: "Verification failed", value: verificationPassed ? 2 : 3 },
    { label: "Verified fixed", value: verificationPassed ? 127 : 126 },
    { label: "SLA breaches", value: 4 },
  ];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-main">
        Skip to main content
      </a>

      <aside className="sidebar" aria-label="Application navigation">
        <div className="sidebar-brand">
          <img
            className="brand-full"
            src="/assets/brand/remedence-logo-primary.png"
            alt="Remedence"
          />
          <img
            className="brand-mark"
            src="/assets/brand/remedence-icon-mark.png"
            alt=""
            aria-hidden="true"
          />
        </div>
        <nav className="nav-primary" aria-label="Primary">
          {primaryNav.map(({ label, icon: Icon, count }) => (
            <button
              key={label}
              type="button"
              className={page === label ? "nav-item active" : "nav-item"}
              aria-current={page === label ? "page" : undefined}
              aria-label={label}
              title={label}
              onClick={() => navigate(label)}
            >
              <Icon aria-hidden="true" />
              <span className="nav-label">{label}</span>
              {count ? <span className="nav-count">{count}</span> : null}
            </button>
          ))}
        </nav>
        <nav className="nav-secondary" aria-label="Secondary">
          {secondaryNav.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              className={page === label ? "nav-item active" : "nav-item"}
              aria-current={page === label ? "page" : undefined}
              aria-label={label}
              title={label}
              onClick={() => navigate(label)}
            >
              <Icon aria-hidden="true" />
              <span className="nav-label">{label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <button
            type="button"
            className="mobile-menu-button"
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-nav"
            aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMobileNavOpen((value) => !value)}
          >
            {mobileNavOpen ? (
              <X aria-hidden="true" />
            ) : (
              <Menu aria-hidden="true" />
            )}
          </button>

          <label className="org-switcher">
            <span className="sr-only">Organization</span>
            <Building2 aria-hidden="true" />
            <select
              aria-label="Organization"
              defaultValue="Harborline Technology Group"
            >
              <option>Harborline Technology Group</option>
            </select>
            <ChevronDown aria-hidden="true" />
          </label>

          <label className="global-search">
            <Search aria-hidden="true" />
            <span className="sr-only">Global search</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search IDs, companies, findings"
            />
          </label>

          <div className="topbar-actions">
            <span className="sync-state" title="Demo workspace data is current">
              <RefreshCw aria-hidden="true" />
              <span>Synced</span>
            </span>
            <div className="notification-wrap">
              <button
                type="button"
                className="icon-button"
                aria-label="Notifications, 2 unread"
                aria-expanded={notificationsOpen}
                onClick={() => setNotificationsOpen((value) => !value)}
              >
                <Bell aria-hidden="true" />
                <span className="notification-dot" aria-hidden="true" />
              </button>
              {notificationsOpen ? (
                <div
                  className="notification-panel"
                  role="region"
                  aria-label="Notifications"
                >
                  <strong>Needs attention</strong>
                  <p>
                    <span className="mono">SEC-1042</span> verification failed.
                    Secondary query path remains exploitable.
                  </p>
                  <p>4 findings are past their remediation SLA.</p>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="user-button"
              aria-label="Open account"
              onClick={() => navigate("Account")}
            >
              <span>HO</span>
            </button>
          </div>
        </header>

        {mobileNavOpen ? (
          <nav
            id="mobile-nav"
            className="mobile-nav"
            aria-label="Mobile navigation"
          >
            {[...primaryNav, ...secondaryNav].map(({ label, icon: Icon }) => (
              <button
                key={label}
                type="button"
                aria-current={page === label ? "page" : undefined}
                onClick={() => navigate(label)}
              >
                <Icon aria-hidden="true" />
                {label}
              </button>
            ))}
          </nav>
        ) : null}

        <main id="workspace-main" className="main-content">
          {page === "Dashboard" ? (
            <Dashboard
              metrics={metrics}
              findings={filteredFindings}
              query={query}
              companyFilter={companyFilter}
              stateFilter={stateFilter}
              severityFilter={severityFilter}
              expandedFinding={expandedFinding}
              verificationPassed={verificationPassed}
              reportReady={reportReady}
              onMetric={applyMetricFilter}
              onQuery={setQuery}
              onCompanyFilter={setCompanyFilter}
              onStateFilter={setStateFilter}
              onSeverityFilter={setSeverityFilter}
              onExpand={setExpandedFinding}
              onOpenFinding={openFinding}
              onNavigate={navigate}
              onOpenOverlay={openOverlay}
            />
          ) : (
            <SecondaryPage
              page={page}
              findings={effectiveFindings}
              verificationPassed={verificationPassed}
              reportReady={reportReady}
              onNavigate={navigate}
              onOpenFinding={openFinding}
            />
          )}
        </main>
      </div>

      {activeFinding ? (
        <VerificationDrawer
          finding={activeFinding}
          verificationPassed={verificationPassed}
          closeRef={drawerCloseRef}
          onClose={closeFinding}
          onRun={runVerification}
          onNavigate={(target) => {
            closeFinding();
            navigate(target);
          }}
        />
      ) : null}

      {overlay === "import" ? (
        <ImportDialog
          closeRef={modalCloseRef}
          onClose={closeOverlay}
          onImport={addImportedFinding}
        />
      ) : null}

      {overlay === "report" ? (
        <ReportDialog
          closeRef={modalCloseRef}
          ready={reportReady}
          onClose={closeOverlay}
          onReady={() => {
            setReportReady(true);
            setLiveMessage(
              "August Security Review marked ready in this demo workspace.",
            );
          }}
        />
      ) : null}

      <div className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </div>
    </div>
  );
}

interface DashboardProps {
  metrics: { label: string; value: number }[];
  findings: Finding[];
  query: string;
  companyFilter: string;
  stateFilter: FindingState | "All states";
  severityFilter: string;
  expandedFinding: string;
  verificationPassed: boolean;
  reportReady: boolean;
  onMetric: (label: string) => void;
  onQuery: (value: string) => void;
  onCompanyFilter: (value: string) => void;
  onStateFilter: (value: FindingState | "All states") => void;
  onSeverityFilter: (value: string) => void;
  onExpand: (id: string) => void;
  onOpenFinding: (finding: Finding, trigger: HTMLButtonElement) => void;
  onNavigate: (page: PageName) => void;
  onOpenOverlay: (
    overlay: "import" | "report",
    trigger: HTMLButtonElement,
  ) => void;
}

function Dashboard(props: DashboardProps) {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Review findings that need remediation or verification.</p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="button secondary"
            onClick={(event) =>
              props.onOpenOverlay("import", event.currentTarget)
            }
          >
            <Import aria-hidden="true" />
            Import findings
          </button>
          <button
            type="button"
            className="button primary"
            onClick={(event) =>
              props.onOpenOverlay("report", event.currentTarget)
            }
          >
            <FileDown aria-hidden="true" />
            Generate report
          </button>
        </div>
      </div>

      <section className="metric-strip" aria-label="Workspace metrics">
        {props.metrics.map((metric) => (
          <button
            key={metric.label}
            type="button"
            aria-label={`${metric.label}: ${metric.value}`}
            onClick={() => props.onMetric(metric.label)}
          >
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </button>
        ))}
      </section>

      <section
        className="operational-section action-queue"
        aria-labelledby="action-queue-title"
      >
        <div className="section-title-row">
          <div>
            <h2 id="action-queue-title">Action queue</h2>
            <p>Failed verification and critical work appear first.</p>
          </div>
          <span className="queue-count">{props.findings.length} shown</span>
        </div>

        <div className="queue-toolbar" aria-label="Action queue filters">
          <label className="filter-search">
            <span>Search findings</span>
            <div>
              <Search aria-hidden="true" />
              <input
                value={props.query}
                onChange={(event) => props.onQuery(event.target.value)}
                placeholder="SEC-1042 or patient-export"
              />
            </div>
          </label>
          <label>
            <span>Company</span>
            <select
              value={props.companyFilter}
              onChange={(event) => props.onCompanyFilter(event.target.value)}
            >
              <option>All companies</option>
              <option>Juniper Ridge Dental</option>
              <option>Alder & Pike Legal</option>
              <option>Cedarline Health</option>
            </select>
          </label>
          <label>
            <span>State</span>
            <select
              value={props.stateFilter}
              onChange={(event) =>
                props.onStateFilter(
                  event.target.value as FindingState | "All states",
                )
              }
            >
              {allStates.map((state) => (
                <option key={state}>{state}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Severity</span>
            <select
              value={props.severityFilter}
              onChange={(event) => props.onSeverityFilter(event.target.value)}
            >
              <option>All severities</option>
              <option>Critical</option>
              <option>High</option>
              <option>Medium</option>
            </select>
          </label>
          <label>
            <span>Owner</span>
            <select defaultValue="All owners">
              <option>All owners</option>
              <option>L. Chen</option>
              <option>M. Ortiz</option>
              <option>S. Patel</option>
            </select>
          </label>
          <label>
            <span>Sort</span>
            <select defaultValue="Priority">
              <option>Priority</option>
              <option>Newest</option>
              <option>SLA</option>
            </select>
          </label>
        </div>

        <details className="mobile-filter-details">
          <summary>
            <SlidersHorizontal aria-hidden="true" />
            Filters and sort
          </summary>
          <div className="mobile-filter-grid">
            <label>
              <span>Company</span>
              <select
                value={props.companyFilter}
                onChange={(event) => props.onCompanyFilter(event.target.value)}
              >
                <option>All companies</option>
                <option>Juniper Ridge Dental</option>
                <option>Alder & Pike Legal</option>
                <option>Cedarline Health</option>
              </select>
            </label>
            <label>
              <span>State</span>
              <select
                value={props.stateFilter}
                onChange={(event) =>
                  props.onStateFilter(
                    event.target.value as FindingState | "All states",
                  )
                }
              >
                {allStates.map((state) => (
                  <option key={state}>{state}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Severity</span>
              <select
                value={props.severityFilter}
                onChange={(event) => props.onSeverityFilter(event.target.value)}
              >
                <option>All severities</option>
                <option>Critical</option>
                <option>High</option>
                <option>Medium</option>
              </select>
            </label>
            <label>
              <span>Owner</span>
              <select defaultValue="All owners">
                <option>All owners</option>
                <option>L. Chen</option>
                <option>M. Ortiz</option>
                <option>S. Patel</option>
              </select>
            </label>
            <label>
              <span>Sort</span>
              <select defaultValue="Priority">
                <option>Priority</option>
                <option>Newest</option>
                <option>SLA</option>
              </select>
            </label>
          </div>
        </details>

        {props.findings.length ? (
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
                    <th scope="col">Age / SLA</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {props.findings.map((finding) => (
                    <QueueRows
                      key={finding.id}
                      finding={finding}
                      expanded={props.expandedFinding === finding.id}
                      verificationPassed={props.verificationPassed}
                      onExpand={() =>
                        props.onExpand(
                          props.expandedFinding === finding.id
                            ? ""
                            : finding.id,
                        )
                      }
                      onOpen={props.onOpenFinding}
                      onNavigate={props.onNavigate}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-queue" aria-label="Action queue">
              {props.findings.map((finding) => (
                <article key={finding.id} className="mobile-finding-row">
                  <div className="mobile-finding-top">
                    <span className="mono">{finding.id}</span>
                    <SeverityChip severity={finding.severity} />
                  </div>
                  <button
                    type="button"
                    className="title-button"
                    onClick={() =>
                      props.onExpand(
                        props.expandedFinding === finding.id ? "" : finding.id,
                      )
                    }
                  >
                    {finding.title}
                  </button>
                  <p>{finding.company}</p>
                  <StatusChip state={finding.state} />
                  {props.expandedFinding === finding.id &&
                  finding.failureReason &&
                  finding.state !== "Verified fixed" ? (
                    <p className="failure-summary">
                      <AlertCircle aria-hidden="true" />
                      {finding.failureReason}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className="row-action"
                    onClick={(event) =>
                      props.onOpenFinding(finding, event.currentTarget)
                    }
                  >
                    {finding.action}
                  </button>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <Search aria-hidden="true" />
            <h3>No findings match these filters.</h3>
            <p>
              Clear one or more filters to return findings to the action queue.
            </p>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                props.onQuery("");
                props.onCompanyFilter("All companies");
                props.onStateFilter("All states");
                props.onSeverityFilter("All severities");
              }}
            >
              Clear filters
            </button>
          </div>
        )}
      </section>

      <div className="dashboard-lower-grid">
        <section className="operational-section" aria-labelledby="risk-title">
          <div className="section-title-row">
            <div>
              <h2 id="risk-title">Company risk overview</h2>
              <p>Customer risk and verification pressure.</p>
            </div>
          </div>
          <div className="company-list">
            {companyRisk.map((company) => (
              <button
                key={company.company}
                type="button"
                onClick={() => props.onNavigate("Companies")}
              >
                <span className="company-name">{company.company}</span>
                <span>
                  Risk <strong>{company.risk}</strong> {company.band}
                </span>
                <span>{company.open} open</span>
                <span>{company.awaiting} awaiting verification</span>
                <span>{company.failed} failed</span>
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
              <p>Latest independent verification outcomes.</p>
            </div>
          </div>
          <div className="activity-list">
            {verificationActivity.map((activity) => (
              <div key={`${activity.id}-${activity.result}`}>
                <span className="mono">{activity.id}</span>
                <strong>{activity.result}</strong>
                <span>{activity.detail}</span>
                <time>{activity.when}</time>
              </div>
            ))}
            {props.verificationPassed ? (
              <div>
                <span className="mono">SEC-1042</span>
                <strong className="success-text">Passed</strong>
                <span>Secondary path clean, evidence locked</span>
                <time>just now</time>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <section className="report-status" aria-labelledby="report-status-title">
        <div>
          <p className="section-kicker">Client report status</p>
          <h2 id="report-status-title">
            Juniper Ridge Dental · August Security Review
          </h2>
          <p>
            Risk score <strong>82 → 61</strong> · 7 verified fixes · Failed
            validation{" "}
            {props.verificationPassed ? "resolved" : "requires follow-up"} · SLA
            compliance 94%
          </p>
        </div>
        <div className="report-meta">
          <span>
            {props.reportReady ? "Ready for review" : "Draft updated 2 min ago"}
          </span>
          <button
            type="button"
            className="button secondary"
            onClick={() => props.onNavigate("Reports")}
          >
            View report
          </button>
        </div>
      </section>
    </>
  );
}

function QueueRows({
  finding,
  expanded,
  verificationPassed,
  onExpand,
  onOpen,
  onNavigate,
}: {
  finding: Finding;
  expanded: boolean;
  verificationPassed: boolean;
  onExpand: () => void;
  onOpen: (finding: Finding, trigger: HTMLButtonElement) => void;
  onNavigate: (page: PageName) => void;
}) {
  const actionPage: Record<string, PageName> = {
    "Start remediation": "Remediation",
    "View remediation": "Remediation",
    "View evidence": "Evidence",
  };
  return (
    <>
      <tr
        className={
          finding.state === "Verification failed" ? "failed-row" : undefined
        }
      >
        <td>{finding.company}</td>
        <td>
          <span className="mono finding-id">{finding.id}</span>
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
          <span>{finding.age}</span>
          {finding.slaBreached ? (
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
            onClick={(event) => {
              if (finding.id === "SEC-1042" || finding.action === "Verify fix")
                onOpen(finding, event.currentTarget);
              else onNavigate(actionPage[finding.action] ?? "Findings");
            }}
          >
            {finding.id === "SEC-1042" && verificationPassed
              ? "View evidence"
              : finding.action}
          </button>
        </td>
      </tr>
      {expanded &&
      finding.failureReason &&
      finding.state !== "Verified fixed" ? (
        <tr className="expanded-row">
          <td colSpan={7}>
            <div>
              <AlertCircle aria-hidden="true" />
              <strong>Verification #1 failed.</strong>
              <span>{finding.failureReason}</span>
              <span>
                The failed result remains part of the verification history after
                a later pass.
              </span>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function VerificationDrawer({
  finding,
  verificationPassed,
  closeRef,
  onClose,
  onRun,
  onNavigate,
}: {
  finding: Finding;
  verificationPassed: boolean;
  closeRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onRun: () => void;
  onNavigate: (page: PageName) => void;
}) {
  const heroFinding = finding.id === "SEC-1042";
  return (
    <div
      className="drawer-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="verification-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="verification-drawer-title"
      >
        <div className="drawer-header">
          <div>
            <span className="mono">{finding.id}</span>
            <h2 id="verification-drawer-title">
              {heroFinding ? "Verify fix" : finding.action}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            aria-label="Close verification drawer"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="drawer-content">
          <div className="drawer-finding">
            <SeverityChip severity={finding.severity} />
            <h3>{finding.title}</h3>
            <p>
              {finding.company} · {finding.source}
            </p>
          </div>
          {heroFinding ? (
            <>
              <section aria-labelledby="prior-run-title">
                <h3 id="prior-run-title">Previous verification</h3>
                <div className="verification-failure">
                  <AlertCircle aria-hidden="true" />
                  <div>
                    <strong>Verification #1 failed</strong>
                    <p>Secondary query path remains exploitable.</p>
                    <span className="mono">
                      2026-08-20 00:16 PDT · independent HTTP regression path
                    </span>
                  </div>
                </div>
              </section>
              <dl className="verification-details">
                <div>
                  <dt>Remediation reference</dt>
                  <dd className="mono">fix/patient-export-secondary-query</dd>
                </div>
                <div>
                  <dt>Verification method</dt>
                  <dd>Security regression replay + scanner rescan</dd>
                </div>
                <div>
                  <dt>Independent worker</dt>
                  <dd>Remedence verification worker</dd>
                </div>
                <div>
                  <dt>Scope</dt>
                  <dd>Patient Portal API · patient-export routes</dd>
                </div>
                <div>
                  <dt>Expected checks</dt>
                  <dd>
                    Primary query blocked · secondary query blocked · regression
                    test passes
                  </dd>
                </div>
                <div>
                  <dt>Estimated compute spend</dt>
                  <dd>No paid AI inference in this demo run</dd>
                </div>
              </dl>
              <section
                className="expected-checks"
                aria-labelledby="checks-title"
              >
                <h3 id="checks-title">Verification checks</h3>
                <div>
                  <CheckCircle2 aria-hidden="true" />
                  <span>
                    Primary query path no longer accepts injection payload
                  </span>
                </div>
                <div>
                  <CheckCircle2 aria-hidden="true" />
                  <span>
                    Secondary query path is covered by the second remediation
                  </span>
                </div>
                <div>
                  <FileCheck2 aria-hidden="true" />
                  <span>
                    Lock evidence only after every independent check passes
                  </span>
                </div>
              </section>
              {verificationPassed ? (
                <div className="verification-success" role="status">
                  <CheckCircle2 aria-hidden="true" />
                  <div>
                    <strong>Verified fixed. Evidence bundle locked.</strong>
                    <p>
                      The failed first verification remains in history. The
                      second independent verification passed after the secondary
                      path was remediated.
                    </p>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="button primary full"
                  onClick={onRun}
                >
                  <ShieldCheck aria-hidden="true" />
                  Run independent verification
                </button>
              )}
              <div className="drawer-actions">
                {verificationPassed ? (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => onNavigate("Evidence")}
                  >
                    View evidence
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => onNavigate("Remediation")}
                  >
                    Return to remediation
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="meaningful-state">
              <ShieldCheck aria-hidden="true" />
              <h3>Awaiting verification</h3>
              <p>
                This v1 scaffold preserves the verification method, scope, and
                evidence boundary. The full worker integration remains
                API-backed work.
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function ImportDialog({
  closeRef,
  onClose,
  onImport,
}: {
  closeRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onImport: (finding: Finding) => void;
}) {
  const [source, setSource] = useState("Semgrep");
  const [company, setCompany] = useState("Juniper Ridge Dental");
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<Finding["severity"]>("High");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!id.trim() || !title.trim()) {
      setError("Finding ID and title are required before importing.");
      return;
    }
    onImport({
      id: id.trim().toUpperCase(),
      company,
      title: title.trim(),
      severity,
      state: "Needs remediation",
      owner: "Unassigned",
      age: "now",
      source,
      action: "Start remediation",
    });
    onClose();
  }

  return (
    <div
      className="modal-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
      >
        <div className="modal-header">
          <div>
            <p className="section-kicker">Local v1 workflow</p>
            <h2 id="import-title">Import findings</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            aria-label="Close import dialog"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={submit} noValidate>
          <label>
            <span>Source</span>
            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option>Semgrep</option>
              <option>Microsoft 365</option>
              <option>Vulnerability scanner</option>
              <option>CSPM</option>
            </select>
          </label>
          <label>
            <span>Company</span>
            <select
              value={company}
              onChange={(event) => setCompany(event.target.value)}
            >
              <option>Juniper Ridge Dental</option>
              <option>Alder & Pike Legal</option>
              <option>Cedarline Health</option>
            </select>
          </label>
          <label>
            <span>Finding ID</span>
            <input
              value={id}
              onChange={(event) => setId(event.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "import-error" : undefined}
              placeholder="SEC-1090"
            />
          </label>
          <label>
            <span>Finding title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "import-error" : undefined}
              placeholder="Describe the finding"
            />
          </label>
          <label>
            <span>Severity</span>
            <select
              value={severity}
              onChange={(event) =>
                setSeverity(event.target.value as Finding["severity"])
              }
            >
              <option>Critical</option>
              <option>High</option>
              <option>Medium</option>
            </select>
          </label>
          {error ? (
            <p id="import-error" className="form-error">
              <AlertCircle aria-hidden="true" />
              {error}
            </p>
          ) : null}
          <div className="modal-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" className="button primary">
              <Import aria-hidden="true" />
              Import finding
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ReportDialog({
  closeRef,
  ready,
  onClose,
  onReady,
}: {
  closeRef: React.RefObject<HTMLButtonElement | null>;
  ready: boolean;
  onClose: () => void;
  onReady: () => void;
}) {
  function downloadReport() {
    const content = [
      "Juniper Ridge Dental - August Security Review",
      "Risk score: 82 -> 61",
      "Critical findings: 3 -> 0",
      "High findings: 8 -> 4",
      "Verified fixes: +7",
      "Failed validation: 1 -> resolved",
      "SLA compliance: 94%",
      "",
      "Demo report generated by the Remedence v1 local interface.",
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/plain" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "juniper-ridge-dental-august-security-review.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="modal-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal report-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
      >
        <div className="modal-header">
          <div>
            <p className="section-kicker">Client report</p>
            <h2 id="report-title">August Security Review</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            aria-label="Close report dialog"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="report-preview">
          <strong>Juniper Ridge Dental</strong>
          <div>
            <span>Risk score</span>
            <b>82 → 61</b>
          </div>
          <div>
            <span>Critical findings</span>
            <b>3 → 0</b>
          </div>
          <div>
            <span>High findings</span>
            <b>8 → 4</b>
          </div>
          <div>
            <span>Verified fixes</span>
            <b>+7</b>
          </div>
          <div>
            <span>SLA compliance</span>
            <b>94%</b>
          </div>
        </div>
        <p className="report-note">
          This v1 generates a local text preview. Server-side PDF/report
          persistence belongs behind the canonical API.
        </p>
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            onClick={downloadReport}
          >
            <FileDown aria-hidden="true" />
            Download text report
          </button>
          <button
            type="button"
            className="button primary"
            disabled={ready}
            onClick={onReady}
          >
            {ready ? (
              <CheckCircle2 aria-hidden="true" />
            ) : (
              <FileCheck2 aria-hidden="true" />
            )}
            {ready ? "Report ready" : "Mark report ready"}
          </button>
        </div>
      </section>
    </div>
  );
}

function SecondaryPage({
  page,
  findings,
  verificationPassed,
  reportReady,
  onNavigate,
  onOpenFinding,
}: {
  page: PageName;
  findings: Finding[];
  verificationPassed: boolean;
  reportReady: boolean;
  onNavigate: (page: PageName) => void;
  onOpenFinding: (finding: Finding, trigger: HTMLButtonElement) => void;
}) {
  const hero = findings.find((finding) => finding.id === "SEC-1042")!;
  if (page === "Companies")
    return (
      <ScaffoldPage
        title="Companies"
        copy="Track customer risk, open findings, and verification pressure."
      >
        <div className="company-list page-list">
          {companyRisk.map((company) => (
            <button
              type="button"
              key={company.company}
              onClick={() => onNavigate("Findings")}
            >
              <span className="company-name">{company.company}</span>
              <span>
                Risk <strong>{company.risk}</strong> {company.band}
              </span>
              <span>{company.open} open</span>
              <span>{company.awaiting} awaiting verification</span>
              <span>{company.failed} failed</span>
            </button>
          ))}
        </div>
      </ScaffoldPage>
    );
  if (page === "Findings")
    return (
      <ScaffoldPage
        title="Findings"
        copy="Normalized findings preserve source, ownership, severity, and remediation state."
      >
        <div className="simple-rows">
          {findings.map((finding) => (
            <div key={finding.id}>
              <span className="mono">{finding.id}</span>
              <div>
                <strong>{finding.title}</strong>
                <small>
                  {finding.company} · {finding.source}
                </small>
              </div>
              <StatusChip state={finding.state} />
            </div>
          ))}
        </div>
      </ScaffoldPage>
    );
  if (page === "Remediation")
    return (
      <ScaffoldPage
        title="Remediation"
        copy="Record what changed before independent verification is allowed to close the finding."
      >
        <div className="timeline">
          <div>
            <span>1</span>
            <div>
              <strong>Primary remediation applied</strong>
              <p className="mono">fix/patient-export-query</p>
            </div>
          </div>
          <div className="failed">
            <span>2</span>
            <div>
              <strong>Independent verification failed</strong>
              <p>Secondary query path remained exploitable.</p>
            </div>
          </div>
          <div>
            <span>3</span>
            <div>
              <strong>Second remediation applied</strong>
              <p className="mono">fix/patient-export-secondary-query</p>
            </div>
          </div>
          <div>
            <span>4</span>
            <div>
              <strong>
                {verificationPassed
                  ? "Independent verification passed"
                  : "Ready for independent verification"}
              </strong>
              <p>The first failed result remains in history.</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          className="button primary"
          onClick={(event) => onOpenFinding(hero, event.currentTarget)}
        >
          <ShieldCheck aria-hidden="true" />
          Verify fix
        </button>
      </ScaffoldPage>
    );
  if (page === "Verification")
    return (
      <ScaffoldPage
        title="Verification"
        copy="Verification is a separate control path. A patch does not certify itself."
      >
        <div className="simple-rows">
          <div>
            <span className="mono">SEC-1042 · RUN-01</span>
            <div>
              <strong className="critical-text">Failed</strong>
              <small>
                Secondary query path remains exploitable · 8 min ago
              </small>
            </div>
            <StatusChip state="Verification failed" />
          </div>
          {verificationPassed ? (
            <div>
              <span className="mono">SEC-1042 · RUN-02</span>
              <div>
                <strong className="success-text">Passed</strong>
                <small>Secondary path clean, evidence locked · just now</small>
              </div>
              <StatusChip state="Verified fixed" />
            </div>
          ) : null}
          <div>
            <span className="mono">SEC-1073 · RUN-14</span>
            <div>
              <strong>Passed</strong>
              <small>Rescan clean, evidence locked · 22 min ago</small>
            </div>
            <StatusChip state="Verified fixed" />
          </div>
        </div>
      </ScaffoldPage>
    );
  if (page === "Evidence")
    return (
      <ScaffoldPage
        title="Evidence"
        copy="Evidence packages preserve what was found, what changed, how it was verified, and who performed the work."
      >
        <div className="evidence-header">
          <div>
            <span className="mono">SEC-1042 · EVIDENCE</span>
            <h2>
              {verificationPassed
                ? "Evidence bundle locked"
                : "Evidence bundle pending verification"}
            </h2>
          </div>
          {verificationPassed ? (
            <span className="locked-state">
              <CheckCircle2 aria-hidden="true" />
              Verified fixed
            </span>
          ) : (
            <span className="locked-state pending">
              <ShieldCheck aria-hidden="true" />
              Awaiting independent pass
            </span>
          )}
        </div>
        <ul className="evidence-list">
          {evidenceItems.map((item) => (
            <li key={item}>
              <FileCheck2 aria-hidden="true" />
              {item}
              <span>
                {verificationPassed
                  ? "Recorded"
                  : item.includes("verification") || item.includes("Rescan")
                    ? "Pending"
                    : "Recorded"}
              </span>
            </li>
          ))}
        </ul>
      </ScaffoldPage>
    );
  if (page === "Reports")
    return (
      <ScaffoldPage
        title="Reports"
        copy="Client-facing reporting reflects verified outcomes, not remediation claims alone."
      >
        <div className="report-status page-report">
          <div>
            <p className="section-kicker">Juniper Ridge Dental</p>
            <h2>August Security Review</h2>
            <p>
              Risk score <strong>82 → 61</strong> · Critical findings{" "}
              <strong>3 → 0</strong> · High findings <strong>8 → 4</strong> ·
              Verified fixes <strong>+7</strong> · SLA compliance{" "}
              <strong>94%</strong>
            </p>
          </div>
          <span className={reportReady ? "locked-state" : "status-chip"}>
            {reportReady ? "Ready for review" : "Draft"}
          </span>
        </div>
      </ScaffoldPage>
    );
  if (page === "Integrations")
    return (
      <ScaffoldPage
        title="Integrations"
        copy="Connect finding sources and operational systems through the same API-first data model."
      >
        <div className="integration-list">
          {[
            "Semgrep",
            "Microsoft 365",
            "Vulnerability scanner",
            "CSPM",
            "GitHub / secret scanner",
          ].map((name) => (
            <div key={name}>
              <Plug aria-hidden="true" />
              <div>
                <strong>{name}</strong>
                <small>
                  Demo source mapping · no production credential configured
                </small>
              </div>
              <span>Mapped</span>
            </div>
          ))}
        </div>
      </ScaffoldPage>
    );
  if (page === "Settings")
    return (
      <ScaffoldPage
        title="Settings"
        copy="Workspace controls for verification policy, evidence retention, and API behavior."
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
                Keep verification history, including failed runs, attached to
                closure records.
              </p>
            </div>
            <span>Enabled</span>
          </div>
          <div>
            <RefreshCw aria-hidden="true" />
            <div>
              <strong>Sync behavior</strong>
              <p>
                Integration sync controls will be backed by the canonical API.
              </p>
            </div>
            <span>Scaffold</span>
          </div>
        </div>
      </ScaffoldPage>
    );
  if (page === "Help")
    return (
      <ScaffoldPage
        title="Help"
        copy="Use the public repository and architecture documentation while the full documentation portal is built."
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
  return (
    <ScaffoldPage
      title="Account"
      copy="Current demo workspace identity and organization context."
    >
      <div className="account-panel">
        <div className="account-avatar">HO</div>
        <div>
          <h2>Harborline Operator</h2>
          <p>Harborline Technology Group · Demo workspace operator</p>
          <small>
            No production identity provider is connected in this v1 local
            interface.
          </small>
        </div>
      </div>
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

export default App;
