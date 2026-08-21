import {
  AlertCircle,
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  FileText,
  FolderCheck,
  LayoutDashboard,
  LifeBuoy,
  Menu,
  Plug,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  UserCircle,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { components } from "../lib/api/schema";

export type PageName =
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

type DashboardSnapshot = components["schemas"]["DashboardSnapshot"];

const primaryNav = [
  { label: "Dashboard" as PageName, icon: LayoutDashboard },
  { label: "Companies" as PageName, icon: Building2 },
  { label: "Findings" as PageName, icon: AlertCircle },
  { label: "Remediation" as PageName, icon: Wrench },
  { label: "Verification" as PageName, icon: ShieldCheck },
  { label: "Evidence" as PageName, icon: FolderCheck },
  { label: "Reports" as PageName, icon: FileText },
  { label: "Integrations" as PageName, icon: Plug },
];

const secondaryNav = [
  { label: "Settings" as PageName, icon: Settings },
  { label: "Help" as PageName, icon: LifeBuoy },
  { label: "Account" as PageName, icon: UserCircle },
];

export function AppShell({
  page,
  search,
  dashboard,
  children,
  onNavigate,
  onSearch,
  onOpenFinding,
}: {
  page: PageName;
  search: string;
  dashboard?: DashboardSnapshot;
  children: ReactNode;
  onNavigate: (page: PageName) => void;
  onSearch: (value: string) => void;
  onOpenFinding: (findingKey: string, trigger: HTMLButtonElement) => void;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const notifications = dashboard?.notifications ?? [];
  const unreadNotificationCount = notifications.filter(
    (notification) => notification.status === "attention",
  ).length;
  const verificationCount = dashboard?.metrics.awaiting_verification;
  const normalizedSearch = search.trim().toLocaleLowerCase("en-US");
  const matchingCompanies = normalizedSearch
    ? (dashboard?.companies ?? []).filter((company) =>
        company.company_name
          .toLocaleLowerCase("en-US")
          .includes(normalizedSearch),
      )
    : [];
  const findingResults = normalizedSearch
    ? (dashboard?.action_queue ?? [])
    : [];
  const searchResultCount = findingResults.length + matchingCompanies.length;

  function navigate(nextPage: PageName) {
    setMobileNavOpen(false);
    setNotificationsOpen(false);
    setSearchOpen(false);
    onNavigate(nextPage);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (mobileNavOpen) setMobileNavOpen(false);
      else if (notificationsOpen) setNotificationsOpen(false);
      else if (searchOpen) setSearchOpen(false);
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [mobileNavOpen, notificationsOpen, searchOpen]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-main">
        Skip to main content
      </a>

      <aside className="sidebar" aria-label="Application navigation">
        <div className="sidebar-brand">
          <img
            className="brand-full"
            src="/assets/brand/remedence-logo-primary-ui.png"
            alt="Remedence"
            width={360}
            height={120}
          />
          <img
            className="brand-mark"
            src="/assets/brand/remedence-icon-mark-ui.png"
            alt=""
            width={96}
            height={96}
            aria-hidden="true"
          />
        </div>
        <nav className="nav-primary" aria-label="Primary">
          {primaryNav.map(({ label, icon: Icon }) => {
            const count =
              label === "Verification" ? verificationCount : undefined;
            return (
              <button
                key={label}
                type="button"
                className={page === label ? "nav-item active" : "nav-item"}
                aria-current={page === label ? "page" : undefined}
                aria-label={count === undefined ? label : `${label} ${count}`}
                title={label}
                onClick={() => navigate(label)}
              >
                <Icon aria-hidden="true" />
                <span className="nav-label">{label}</span>
                {count === undefined ? null : (
                  <span className="nav-count">{count}</span>
                )}
              </button>
            );
          })}
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

          <div className="global-search-wrap">
            <label className="global-search">
              <Search aria-hidden="true" />
              <span className="sr-only">Global search</span>
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  const value = event.target.value;
                  onSearch(value);
                  setSearchOpen(Boolean(value.trim()));
                }}
                onFocus={() => {
                  if (search.trim()) setSearchOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Escape" || !searchOpen) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setSearchOpen(false);
                }}
                placeholder="Search IDs, companies, findings"
              />
            </label>
            {searchOpen && normalizedSearch ? (
              <section
                id="global-search-results"
                className="workspace-search-panel"
                role="region"
                aria-label="Global search results"
              >
                <div className="workspace-search-summary">
                  <strong>Search workspace</strong>
                  <span>
                    {searchResultCount}{" "}
                    {searchResultCount === 1 ? "result" : "results"}
                  </span>
                </div>
                {searchResultCount ? (
                  <ul className="workspace-search-list">
                    {findingResults.map((finding) => (
                      <li
                        className="workspace-search-item"
                        key={`finding:${finding.id}`}
                      >
                        <div className="workspace-search-copy">
                          <strong>{finding.finding_key}</strong>
                          <span>
                            {finding.title} · {finding.company_name} ·{" "}
                            {finding.state}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="button secondary"
                          aria-label={`Open finding ${finding.finding_key}`}
                          onClick={(event) => {
                            setSearchOpen(false);
                            onOpenFinding(
                              finding.finding_key,
                              event.currentTarget,
                            );
                          }}
                        >
                          Open finding
                        </button>
                      </li>
                    ))}
                    {matchingCompanies.map((company) => (
                      <li
                        className="workspace-search-item"
                        key={`company:${company.company_id}`}
                      >
                        <div className="workspace-search-copy">
                          <strong>{company.company_name}</strong>
                          <span>
                            Risk {company.risk_score} {company.risk_level} ·{" "}
                            {company.open_findings} open
                          </span>
                        </div>
                        <button
                          type="button"
                          className="button secondary"
                          aria-label={`Open company ${company.company_name}`}
                          onClick={() => navigate("Companies")}
                        >
                          Open company
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="workspace-search-empty">
                    No companies or findings match this search.
                  </p>
                )}
              </section>
            ) : null}
          </div>

          <div className="topbar-actions">
            <span
              className="sync-state"
              title={
                dashboard
                  ? "Read models are current"
                  : "Refreshing local read models"
              }
            >
              <RefreshCw aria-hidden="true" />
              <span>{dashboard ? "Synced" : "Refreshing"}</span>
            </span>
            <div className="notification-wrap">
              <button
                type="button"
                className="icon-button"
                aria-label={`Notifications, ${unreadNotificationCount} unread`}
                aria-expanded={notificationsOpen}
                onClick={() => setNotificationsOpen((value) => !value)}
              >
                <Bell aria-hidden="true" />
                {unreadNotificationCount ? (
                  <span className="notification-dot" aria-hidden="true" />
                ) : null}
              </button>
              {notificationsOpen ? (
                <div
                  className="notification-panel"
                  role="region"
                  aria-label="Notifications"
                >
                  {notifications.length ? (
                    notifications.map((notification) => (
                      <div className="notification-item" key={notification.id}>
                        <div
                          className={`notification-status notification-${notification.status}`}
                        >
                          {notification.status === "resolved" ? (
                            <CheckCircle2 aria-hidden="true" />
                          ) : (
                            <AlertCircle aria-hidden="true" />
                          )}
                          <strong>
                            {notification.status === "resolved"
                              ? "Resolved"
                              : "Needs attention"}
                          </strong>
                        </div>
                        <p>{notification.message}</p>
                      </div>
                    ))
                  ) : (
                    <p className="workspace-search-empty">
                      No current notifications.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="user-button"
              aria-label="HO, open account"
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
          {children}
        </main>
      </div>
    </div>
  );
}
