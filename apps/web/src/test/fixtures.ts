import type { components } from "../lib/api/schema";

export type DashboardSnapshot = components["schemas"]["DashboardSnapshot"];
export type DashboardFinding = components["schemas"]["DashboardFinding"];

export const dashboardFindingFixture: DashboardFinding = {
  id: "finding-api-2099",
  organization_id: "org-harborline",
  company_id: "company-juniper",
  finding_key: "SEC-2099",
  title: "API-backed patient export regression",
  description: "Persisted finding returned by the local API.",
  source: "API fixture",
  severity: "Critical",
  state: "Verification failed",
  owner: "A. Rivera",
  asset_name: "patient-export-api",
  detected_at: "2026-08-20T18:00:00.000Z",
  sla_due_at: "2026-08-20T22:00:00.000Z",
  created_at: "2026-08-20T18:00:00.000Z",
  updated_at: "2026-08-20T18:30:00.000Z",
  version: 1,
  company_name: "Juniper Ridge Dental",
  sla_breached: true,
  priority_bucket: 1,
};

export const dashboardFixture: DashboardSnapshot = {
  metrics: {
    managed_companies: 21,
    open_findings: 34,
    awaiting_verification: 5,
    verification_failed: 2,
    verified_fixed: 99,
    sla_breaches: 7,
  },
  action_queue: [dashboardFindingFixture],
  companies: [
    {
      company_id: "company-juniper",
      company_name: "Juniper Ridge Dental",
      risk_score: 67,
      risk_level: "High",
      open_findings: 4,
      awaiting_verification: 1,
      verification_failed: 1,
    },
    {
      company_id: "company-alder",
      company_name: "Alder & Pike Legal",
      risk_score: 48,
      risk_level: "Medium",
      open_findings: 2,
      awaiting_verification: 0,
      verification_failed: 0,
    },
  ],
  verification_activity: [
    {
      verification_id: "verification-api-1",
      finding_key: "SEC-2099",
      company_name: "Juniper Ridge Dental",
      status: "Failed",
      result_summary: "Secondary path still accepted the regression payload.",
      completed_at: "2026-08-20T18:25:00.000Z",
    },
  ],
  notifications: [
    {
      id: "verification-failed",
      status: "attention",
      message: "2 findings have failed verification.",
    },
  ],
  latest_report: {
    id: "report-api-1",
    company_id: "company-juniper",
    title: "August Security Review",
    period_label: "August",
    status: "Ready",
    snapshot: {
      company_name: "Juniper Ridge Dental",
      risk_score: 67,
      critical_findings: 1,
      high_findings: 2,
      verified_fixes: 9,
      sla_compliance_percent: 96,
      findings: [],
      verification_history: [],
    },
    generated_at: "2026-08-20T18:35:00.000Z",
    created_at: "2026-08-20T18:35:00.000Z",
  },
};
