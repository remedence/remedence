export type FindingState =
  | "Verification failed"
  | "Awaiting verification"
  | "Needs remediation"
  | "Remediating"
  | "Verified fixed";

export type Severity = "Critical" | "High" | "Medium";

export interface Finding {
  id: string;
  company: string;
  title: string;
  severity: Severity;
  state: FindingState;
  owner: string;
  age: string;
  source: string;
  action: string;
  failureReason?: string;
  slaBreached?: boolean;
}

export const findings: Finding[] = [
  {
    id: "SEC-1042",
    company: "Juniper Ridge Dental",
    title: "SQL injection in patient-export API",
    severity: "Critical",
    state: "Verification failed",
    owner: "L. Chen",
    age: "2h",
    source: "Semgrep",
    action: "View finding",
    failureReason: "Secondary query path remains exploitable.",
  },
  {
    id: "SEC-1067",
    company: "Juniper Ridge Dental",
    title: "Known-exploited vulnerability exposure",
    severity: "Critical",
    state: "Awaiting verification",
    owner: "L. Chen",
    age: "6h",
    source: "Vulnerability scanner",
    action: "Verify fix",
  },
  {
    id: "SEC-1058",
    company: "Alder & Pike Legal",
    title: "Administrator MFA coverage gap",
    severity: "High",
    state: "Needs remediation",
    owner: "M. Ortiz",
    age: "1d",
    source: "Microsoft 365",
    action: "Start remediation",
    slaBreached: true,
  },
  {
    id: "SEC-1081",
    company: "Alder & Pike Legal",
    title: "Hardcoded API credential",
    severity: "High",
    state: "Remediating",
    owner: "M. Ortiz",
    age: "4h",
    source: "GitHub / secret scanner",
    action: "View remediation",
  },
  {
    id: "SEC-1073",
    company: "Cedarline Health",
    title: "Public cloud storage exposure",
    severity: "High",
    state: "Verified fixed",
    owner: "S. Patel",
    age: "3d",
    source: "CSPM",
    action: "View evidence",
  },
];

export const companyRisk = [
  {
    company: "Juniper Ridge Dental",
    risk: 82,
    band: "High",
    open: 9,
    awaiting: 2,
    failed: 1,
  },
  {
    company: "Alder & Pike Legal",
    risk: 74,
    band: "High",
    open: 6,
    awaiting: 3,
    failed: 1,
  },
  {
    company: "Cedarline Health",
    risk: 51,
    band: "Medium",
    open: 3,
    awaiting: 1,
    failed: 0,
  },
];

export const verificationActivity = [
  {
    id: "SEC-1042",
    result: "Failed",
    detail: "Secondary query path remains exploitable",
    when: "8 min ago",
  },
  {
    id: "SEC-1073",
    result: "Passed",
    detail: "Rescan clean, evidence locked",
    when: "22 min ago",
  },
  {
    id: "SEC-1067",
    result: "Waiting",
    detail: "Verification queued",
    when: "31 min ago",
  },
];

export const evidenceItems = [
  "Original scanner finding",
  "Original vulnerable-code hash",
  "Patch commit",
  "Security regression test",
  "Independent verification result",
  "Rescan result",
  "Before/after evidence",
  "Technician identity",
  "Timestamped audit trail",
];
