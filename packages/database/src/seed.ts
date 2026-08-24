import { createHash } from "node:crypto";
import type {
  Clock,
  FindingState,
  RemediationStatus,
  RiskLevel,
  Severity,
} from "@remedence/core";
import { getDatabaseConnection, type RemedenceDatabase } from "./database.js";
import { runTransaction } from "./transaction.js";

const ORGANIZATION_ID = "org-harborline";
const ORGANIZATION_NAME = "Harborline Technology Group";
const FIXED_CREATED_AT = "2026-08-01T00:00:00.000Z";
const HERO_FAILURE_AT = "2026-08-12T00:10:00.000Z";
const PAST_SLA = "2026-08-19T00:00:00.000Z";
const FUTURE_SLA = "2026-09-20T00:00:00.000Z";
const VERIFIED_BASE_AT = Date.parse("2026-07-01T00:00:00.000Z");
const OPEN_BASE_AT = Date.parse("2026-08-02T00:00:00.000Z");

export interface HarborlineSeedRuntime {
  clock: Clock;
}

interface SeedCompany {
  id: string;
  name: string;
  riskScore: number;
  riskLevel: RiskLevel;
  openTarget: number;
  awaitingTarget: number;
  failedTarget: number;
}

interface SeedFinding {
  id: string;
  companyId: string;
  findingKey: string;
  title: string;
  description: string;
  source: string;
  severity: Severity;
  state: FindingState;
  owner: string;
  assetName: string;
  detectedAt: string;
  slaDueAt: string;
  createdAt: string;
  updatedAt: string;
}

const COMPANIES: readonly SeedCompany[] = [
  {
    id: "company-juniper-ridge-dental",
    name: "Juniper Ridge Dental",
    riskScore: 82,
    riskLevel: "High",
    openTarget: 9,
    awaitingTarget: 2,
    failedTarget: 1,
  },
  {
    id: "company-alder-pike-legal",
    name: "Alder & Pike Legal",
    riskScore: 74,
    riskLevel: "High",
    openTarget: 6,
    awaitingTarget: 3,
    failedTarget: 1,
  },
  {
    id: "company-cedarline-health",
    name: "Cedarline Health",
    riskScore: 51,
    riskLevel: "Medium",
    openTarget: 3,
    awaitingTarget: 1,
    failedTarget: 0,
  },
  {
    id: "company-northstar-manufacturing",
    name: "Northstar Manufacturing",
    riskScore: 69,
    riskLevel: "High",
    openTarget: 4,
    awaitingTarget: 1,
    failedTarget: 0,
  },
  {
    id: "company-bluehaven-retail",
    name: "Bluehaven Retail",
    riskScore: 63,
    riskLevel: "High",
    openTarget: 4,
    awaitingTarget: 1,
    failedTarget: 0,
  },
  {
    id: "company-summit-architecture",
    name: "Summit Architecture",
    riskScore: 58,
    riskLevel: "Medium",
    openTarget: 4,
    awaitingTarget: 0,
    failedTarget: 0,
  },
  {
    id: "company-silveroak-logistics",
    name: "Silveroak Logistics",
    riskScore: 66,
    riskLevel: "High",
    openTarget: 4,
    awaitingTarget: 0,
    failedTarget: 1,
  },
  {
    id: "company-redwood-advisors",
    name: "Redwood Advisors",
    riskScore: 47,
    riskLevel: "Medium",
    openTarget: 3,
    awaitingTarget: 0,
    failedTarget: 0,
  },
  {
    id: "company-clearwater-hospitality",
    name: "Clearwater Hospitality",
    riskScore: 44,
    riskLevel: "Medium",
    openTarget: 3,
    awaitingTarget: 0,
    failedTarget: 0,
  },
  {
    id: "company-beacon-nonprofit",
    name: "Beacon Nonprofit",
    riskScore: 39,
    riskLevel: "Medium",
    openTarget: 3,
    awaitingTarget: 0,
    failedTarget: 0,
  },
  {
    id: "company-ironwood-construction",
    name: "Ironwood Construction",
    riskScore: 32,
    riskLevel: "Low",
    openTarget: 1,
    awaitingTarget: 0,
    failedTarget: 0,
  },
  {
    id: "company-lakeshore-services",
    name: "Lakeshore Services",
    riskScore: 55,
    riskLevel: "Medium",
    openTarget: 3,
    awaitingTarget: 0,
    failedTarget: 0,
  },
] as const;

const FEATURED_OPEN_FINDINGS: readonly SeedFinding[] = [
  {
    id: "finding-sec-1042",
    companyId: "company-juniper-ridge-dental",
    findingKey: "SEC-1042",
    title: "SQL injection in patient-export API",
    description:
      "The patient-export API accepts attacker-controlled query input. The first remediation did not cover a secondary query path.",
    source: "Semgrep",
    severity: "Critical",
    state: "Verification failed",
    owner: "L. Chen",
    assetName: "Patient Portal API",
    detectedAt: "2026-08-10T08:00:00.000Z",
    slaDueAt: PAST_SLA,
    createdAt: "2026-08-10T08:00:00.000Z",
    updatedAt: HERO_FAILURE_AT,
  },
  {
    id: "finding-sec-1058",
    companyId: "company-alder-pike-legal",
    findingKey: "SEC-1058",
    title: "Administrator MFA coverage gap",
    description:
      "One administrator account is missing the required MFA coverage.",
    source: "Microsoft 365",
    severity: "High",
    state: "Needs remediation",
    owner: "M. Ortiz",
    assetName: "Microsoft 365 tenant",
    detectedAt: "2026-08-11T09:00:00.000Z",
    slaDueAt: PAST_SLA,
    createdAt: "2026-08-11T09:00:00.000Z",
    updatedAt: "2026-08-11T09:00:00.000Z",
  },
  {
    id: "finding-sec-1067",
    companyId: "company-juniper-ridge-dental",
    findingKey: "SEC-1067",
    title: "Internet-facing known-exploited vulnerability exposure",
    description:
      "An internet-facing asset requires independent verification after remediation.",
    source: "Vulnerability scanner",
    severity: "Critical",
    state: "Awaiting verification",
    owner: "L. Chen",
    assetName: "Edge Application Gateway",
    detectedAt: "2026-08-14T10:00:00.000Z",
    slaDueAt: FUTURE_SLA,
    createdAt: "2026-08-14T10:00:00.000Z",
    updatedAt: "2026-08-18T10:00:00.000Z",
  },
  {
    id: "finding-sec-1081",
    companyId: "company-alder-pike-legal",
    findingKey: "SEC-1081",
    title: "Hardcoded API credential",
    description:
      "A repository contains a hardcoded API credential requiring rotation.",
    source: "GitHub / secret scanner",
    severity: "High",
    state: "Remediating",
    owner: "M. Ortiz",
    assetName: "Client Intake Repository",
    detectedAt: "2026-08-17T12:00:00.000Z",
    slaDueAt: FUTURE_SLA,
    createdAt: "2026-08-17T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z",
  },
] as const;

const FEATURED_VERIFIED_FINDING: SeedFinding = {
  id: "finding-sec-1073",
  companyId: "company-cedarline-health",
  findingKey: "SEC-1073",
  title: "Public cloud storage exposure",
  description:
    "A public cloud storage exposure was independently retested and closed.",
  source: "CSPM",
  severity: "High",
  state: "Verified fixed",
  owner: "S. Patel",
  assetName: "Clinical Export Storage",
  detectedAt: "2026-07-28T08:00:00.000Z",
  slaDueAt: "2026-08-04T08:00:00.000Z",
  createdAt: "2026-07-28T08:00:00.000Z",
  updatedAt: "2026-08-06T14:00:00.000Z",
};

const SOURCES = [
  "Manual",
  "Microsoft 365",
  "Vulnerability scanner",
  "CSPM",
  "GitHub / secret scanner",
] as const;
const OWNERS = [
  "L. Chen",
  "M. Ortiz",
  "S. Patel",
  "R. Singh",
  "A. Brooks",
] as const;
const SEVERITIES: readonly Severity[] = ["High", "Medium", "Low", "Info"];

function timestamp(base: number, offsetMinutes: number): string {
  return new Date(base + offsetMinutes * 60_000).toISOString();
}

function requireCanonicalTimestamp(value: string, name: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new TypeError(`${name} must be a canonical UTC ISO 8601 timestamp.`);
  }
}

function readCount(row: unknown): number {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new TypeError("Seed count query did not return a row.");
  }
  const count = (row as Record<string, unknown>).count;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new TypeError("Seed count query returned an invalid count.");
  }
  return count;
}

function contentHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function createOpenFillers(): SeedFinding[] {
  const findings: SeedFinding[] = [];
  let key = 2000;
  let extraBreaches = 2;

  for (const company of COMPANIES) {
    const featured = FEATURED_OPEN_FINDINGS.filter(
      (finding) => finding.companyId === company.id,
    );
    const featuredAwaiting = featured.filter(
      (finding) => finding.state === "Awaiting verification",
    ).length;
    const featuredFailed = featured.filter(
      (finding) => finding.state === "Verification failed",
    ).length;
    const remaining = company.openTarget - featured.length;
    const remainingAwaiting = company.awaitingTarget - featuredAwaiting;
    const remainingFailed = company.failedTarget - featuredFailed;

    if (remaining < 0 || remainingAwaiting < 0 || remainingFailed < 0) {
      throw new Error(`Seed targets are invalid for ${company.name}.`);
    }

    for (let index = 0; index < remaining; index += 1) {
      let state: FindingState;
      if (index < remainingAwaiting) {
        state = "Awaiting verification";
      } else if (index < remainingAwaiting + remainingFailed) {
        state = "Verification failed";
      } else {
        state = index % 3 === 0 ? "Remediating" : "Needs remediation";
      }

      const isBreached = extraBreaches > 0;
      if (isBreached) extraBreaches -= 1;
      const sequence = key - 2000;
      const findingKey = `SEC-${key}`;
      const detectedAt = timestamp(OPEN_BASE_AT, sequence * 137);
      findings.push({
        id: `finding-${findingKey.toLowerCase()}`,
        companyId: company.id,
        findingKey,
        title: `Managed security finding ${findingKey}`,
        description: `Deterministic Harborline demo finding ${findingKey} for ${company.name}.`,
        source: SOURCES[sequence % SOURCES.length] ?? "Manual",
        severity: SEVERITIES[sequence % SEVERITIES.length] ?? "Medium",
        state,
        owner: OWNERS[sequence % OWNERS.length] ?? "S. Patel",
        assetName: `${company.name} managed asset ${sequence + 1}`,
        detectedAt,
        slaDueAt: isBreached
          ? timestamp(OPEN_BASE_AT, 60 + sequence)
          : timestamp(Date.parse(FUTURE_SLA), sequence),
        createdAt: detectedAt,
        updatedAt: detectedAt,
      });
      key += 1;
    }
  }

  return findings;
}

function createVerifiedFillers(): SeedFinding[] {
  const findings: SeedFinding[] = [];
  for (let index = 0; index < 125; index += 1) {
    const company = COMPANIES[index % COMPANIES.length];
    if (!company) throw new Error("Verified seed company is missing.");
    const findingKey = `SEC-${5000 + index}`;
    const detectedAt = timestamp(VERIFIED_BASE_AT, index * 83);
    const updatedAt = timestamp(VERIFIED_BASE_AT, index * 83 + 720);
    findings.push({
      id: `finding-${findingKey.toLowerCase()}`,
      companyId: company.id,
      findingKey,
      title: `Historically verified finding ${findingKey}`,
      description: `A historical Harborline finding with independently verified closure for ${company.name}.`,
      source: SOURCES[index % SOURCES.length] ?? "Manual",
      severity: SEVERITIES[index % SEVERITIES.length] ?? "Medium",
      state: "Verified fixed",
      owner: OWNERS[index % OWNERS.length] ?? "S. Patel",
      assetName: `${company.name} historical asset ${index + 1}`,
      detectedAt,
      slaDueAt: timestamp(VERIFIED_BASE_AT, index * 83 + 2_880),
      createdAt: detectedAt,
      updatedAt,
    });
  }
  return findings;
}

function createRemediationStatus(
  state: FindingState,
): RemediationStatus | undefined {
  if (state === "Remediating") return "In progress";
  if (
    state === "Awaiting verification" ||
    state === "Verification failed" ||
    state === "Verified fixed"
  ) {
    return "Completed";
  }
  return undefined;
}

export function seedHarborline(
  database: RemedenceDatabase,
  runtime: HarborlineSeedRuntime,
): { applied: boolean } {
  const connection = getDatabaseConnection(database);
  const organizationCount = readCount(
    connection.prepare("SELECT COUNT(id) AS count FROM organizations").get(),
  );
  if (organizationCount !== 0) return { applied: false };

  const appliedAt = runtime.clock.now();
  requireCanonicalTimestamp(appliedAt, "runtime.clock.now()");

  return runTransaction(database, () => {
    const insertOrganization = connection.prepare(
      `INSERT INTO organizations (
         id, name, slug, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?)`,
    );
    const insertCompany = connection.prepare(
      `INSERT INTO companies (
         id, organization_id, name, risk_score, risk_level, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertFinding = connection.prepare(
      `INSERT INTO findings (
         id, organization_id, company_id, finding_key, title, description,
         source, severity, state, owner, asset_name, detected_at, sla_due_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertRemediation = connection.prepare(
      `INSERT INTO remediations (
         organization_id, id, finding_id, status, summary, reference, owner, started_at,
         completed_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertVerification = connection.prepare(
      `INSERT INTO verification_runs (
         organization_id, id, finding_id, remediation_id, status, method, worker_name, scope,
         result_summary, started_at, completed_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertCheck = connection.prepare(
      `INSERT INTO verification_checks (
         organization_id, id, verification_id, sequence, name, status, message, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertEvidence = connection.prepare(
      `INSERT INTO evidence_items (
         organization_id, id, finding_id, verification_id, kind, label, source_reference,
         content_hash, metadata_json, created_at, locked_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertReport = connection.prepare(
      `INSERT INTO reports (
         organization_id, id, company_id, title, period_label, status, snapshot_json,
         generated_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertAuditEvent = connection.prepare(
      `INSERT INTO audit_events (
         organization_id, actor_type, actor_id, action, entity_type, entity_id,
         details_json, occurred_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    function appendAudit(
      action: string,
      entityType: string,
      entityId: string,
      details: Record<string, unknown>,
      occurredAt: string,
    ): void {
      insertAuditEvent.run(
        ORGANIZATION_ID,
        "system",
        "harborline-seed",
        action,
        entityType,
        entityId,
        JSON.stringify(details),
        occurredAt,
      );
    }

    function insertFindingRow(finding: SeedFinding): void {
      insertFinding.run(
        finding.id,
        ORGANIZATION_ID,
        finding.companyId,
        finding.findingKey,
        finding.title,
        finding.description,
        finding.source,
        finding.severity,
        finding.state,
        finding.owner,
        finding.assetName,
        finding.detectedAt,
        finding.slaDueAt,
        finding.createdAt,
        finding.updatedAt,
      );
    }

    function seedFindingHistory(finding: SeedFinding): void {
      if (finding.findingKey === "SEC-1042") return;
      const remediationStatus = createRemediationStatus(finding.state);
      if (remediationStatus === undefined) return;

      const remediationId = `remediation-${finding.findingKey.toLowerCase()}-1`;
      const remediationStartedAt = timestamp(
        Date.parse(finding.detectedAt),
        120,
      );
      const remediationCompletedAt =
        remediationStatus === "Completed"
          ? timestamp(Date.parse(remediationStartedAt), 180)
          : null;
      insertRemediation.run(
        ORGANIZATION_ID,
        remediationId,
        finding.id,
        remediationStatus,
        remediationStatus === "Completed"
          ? "Remediation completed and recorded for independent verification"
          : "Remediation work is in progress",
        `CHG-${finding.findingKey}-1`,
        finding.owner,
        remediationStartedAt,
        remediationCompletedAt,
        remediationStartedAt,
        remediationCompletedAt ?? remediationStartedAt,
      );

      if (remediationStatus === "In progress") {
        appendAudit(
          "remediation.started",
          "remediation",
          remediationId,
          { finding_id: finding.id },
          remediationStartedAt,
        );
        return;
      }

      appendAudit(
        "remediation.completed",
        "remediation",
        remediationId,
        { finding_id: finding.id },
        remediationCompletedAt ?? remediationStartedAt,
      );

      if (finding.state === "Awaiting verification") return;

      const verificationId = `verification-${finding.findingKey.toLowerCase()}-1`;
      const verificationStartedAt = timestamp(
        Date.parse(remediationCompletedAt ?? remediationStartedAt),
        60,
      );
      const verificationCompletedAt = timestamp(
        Date.parse(verificationStartedAt),
        15,
      );
      const passed = finding.state === "Verified fixed";
      insertVerification.run(
        ORGANIZATION_ID,
        verificationId,
        finding.id,
        remediationId,
        passed ? "Passed" : "Failed",
        "Independent verification",
        "Harborline verification operator",
        finding.assetName,
        passed
          ? "Independent verification passed"
          : "Independent verification found remaining exposure",
        verificationStartedAt,
        verificationCompletedAt,
        verificationStartedAt,
      );
      insertCheck.run(
        ORGANIZATION_ID,
        `check-${finding.findingKey.toLowerCase()}-1`,
        verificationId,
        1,
        "Independent verification check",
        passed ? "Passed" : "Failed",
        passed
          ? "No vulnerable behavior reproduced"
          : "Remaining vulnerable behavior reproduced",
        verificationCompletedAt,
      );
      appendAudit(
        passed ? "verification.passed" : "verification.failed",
        "verification",
        verificationId,
        { finding_id: finding.id },
        verificationCompletedAt,
      );

      if (!passed) return;

      const evidenceId = `evidence-${finding.findingKey.toLowerCase()}-1`;
      const hash = contentHash(
        `${finding.findingKey}:${verificationId}:passed`,
      );
      insertEvidence.run(
        ORGANIZATION_ID,
        evidenceId,
        finding.id,
        verificationId,
        "verification-result",
        "Independent verification result",
        `verification://${verificationId}`,
        hash,
        JSON.stringify({
          finding_key: finding.findingKey,
          verification_id: verificationId,
          result: "Passed",
        }),
        verificationCompletedAt,
        verificationCompletedAt,
      );
      appendAudit(
        "evidence.locked",
        "evidence",
        evidenceId,
        { finding_id: finding.id, verification_id: verificationId },
        verificationCompletedAt,
      );
    }

    insertOrganization.run(
      ORGANIZATION_ID,
      ORGANIZATION_NAME,
      "harborline-technology-group",
      FIXED_CREATED_AT,
      FIXED_CREATED_AT,
    );

    for (const company of COMPANIES) {
      insertCompany.run(
        company.id,
        ORGANIZATION_ID,
        company.name,
        company.riskScore,
        company.riskLevel,
        FIXED_CREATED_AT,
        FIXED_CREATED_AT,
      );
    }

    const openFindings = [...FEATURED_OPEN_FINDINGS, ...createOpenFillers()];
    const verifiedFindings = [
      FEATURED_VERIFIED_FINDING,
      ...createVerifiedFillers(),
    ];

    for (const finding of [...openFindings, ...verifiedFindings]) {
      insertFindingRow(finding);
      appendAudit(
        "finding.imported",
        "finding",
        finding.id,
        { finding_key: finding.findingKey, source: finding.source },
        finding.createdAt,
      );
      seedFindingHistory(finding);
    }

    const hero = FEATURED_OPEN_FINDINGS[0];
    if (!hero) throw new Error("SEC-1042 seed finding is missing.");
    const heroRemediationId = "remediation-sec-1042-1";
    insertRemediation.run(
      ORGANIZATION_ID,
      heroRemediationId,
      hero.id,
      "Completed",
      "Parameterize the primary patient-export query path",
      "CHG-SEC-1042-1",
      hero.owner,
      "2026-08-11T08:00:00.000Z",
      "2026-08-11T12:00:00.000Z",
      "2026-08-11T08:00:00.000Z",
      "2026-08-11T12:00:00.000Z",
    );
    appendAudit(
      "remediation.completed",
      "finding",
      hero.id,
      { remediation_id: heroRemediationId, reference: "CHG-SEC-1042-1" },
      "2026-08-11T12:00:00.000Z",
    );

    const heroVerificationId = "verification-sec-1042-1";
    insertVerification.run(
      ORGANIZATION_ID,
      heroVerificationId,
      hero.id,
      heroRemediationId,
      "Failed",
      "Independent manual retest",
      "Harborline verification operator",
      "Patient Portal API primary and secondary query paths",
      "Secondary query path remains vulnerable",
      "2026-08-12T00:00:00.000Z",
      HERO_FAILURE_AT,
      "2026-08-12T00:00:00.000Z",
    );
    insertCheck.run(
      ORGANIZATION_ID,
      "check-sec-1042-primary",
      heroVerificationId,
      1,
      "Primary query path",
      "Passed",
      "Primary query path no longer reproduces SQL injection",
      "2026-08-12T00:05:00.000Z",
    );
    insertCheck.run(
      ORGANIZATION_ID,
      "check-sec-1042-secondary",
      heroVerificationId,
      2,
      "Secondary query path",
      "Failed",
      "Secondary query path remains vulnerable",
      "2026-08-12T00:06:00.000Z",
    );
    appendAudit(
      "verification.failed",
      "finding",
      hero.id,
      {
        verification_id: heroVerificationId,
        summary: "Secondary query path remains vulnerable",
      },
      HERO_FAILURE_AT,
    );

    const juniperOpenFindings = openFindings.filter(
      (finding) => finding.companyId === "company-juniper-ridge-dental",
    );
    const juniperVerifiedFindings = verifiedFindings.filter(
      (finding) => finding.companyId === "company-juniper-ridge-dental",
    );
    const reportSnapshot = {
      companyName: "Juniper Ridge Dental",
      riskScore: 82,
      criticalFindings: juniperOpenFindings.filter(
        (finding) => finding.severity === "Critical",
      ).length,
      highFindings: juniperOpenFindings.filter(
        (finding) => finding.severity === "High",
      ).length,
      verifiedFixes: juniperVerifiedFindings.length,
      slaCompliancePercent: 94,
      findings: [...juniperOpenFindings, ...juniperVerifiedFindings].map(
        (finding) => ({
          ...finding,
          organizationId: ORGANIZATION_ID,
        }),
      ),
      verificationHistory: [
        {
          id: heroVerificationId,
          findingId: hero.id,
          remediationId: heroRemediationId,
          status: "Failed",
          method: "Independent manual retest",
          workerName: "Harborline verification operator",
          verifierPrincipalId: "legacy-unattributed",
          credentialType: "legacy-assertion",
          executionSource: "legacy-untrusted",
          sourceRevision: "legacy-unavailable",
          patchDigest: "0".repeat(64),
          scope: "Patient Portal API primary and secondary query paths",
          resultSummary: "Secondary query path remains vulnerable",
          startedAt: "2026-08-12T00:00:00.000Z",
          completedAt: HERO_FAILURE_AT,
          createdAt: "2026-08-12T00:00:00.000Z",
          checks: [
            {
              id: "check-sec-1042-primary",
              verificationId: heroVerificationId,
              sequence: 1,
              name: "Primary query path",
              status: "Passed",
              message: "Primary query path no longer reproduces SQL injection",
              createdAt: "2026-08-12T00:05:00.000Z",
            },
            {
              id: "check-sec-1042-secondary",
              verificationId: heroVerificationId,
              sequence: 2,
              name: "Secondary query path",
              status: "Failed",
              message: "Secondary query path remains vulnerable",
              createdAt: "2026-08-12T00:06:00.000Z",
            },
          ],
          findingKey: hero.findingKey,
        },
      ],
    };
    insertReport.run(
      ORGANIZATION_ID,
      "report-juniper-august-2026-draft",
      "company-juniper-ridge-dental",
      "Juniper Ridge Dental — August Security Review",
      "August 2026",
      "Draft",
      JSON.stringify(reportSnapshot),
      "2026-08-20T10:30:00.000Z",
      "2026-08-20T10:30:00.000Z",
    );
    appendAudit(
      "report.draft_created",
      "report",
      "report-juniper-august-2026-draft",
      { company_id: "company-juniper-ridge-dental" },
      "2026-08-20T10:30:00.000Z",
    );
    appendAudit(
      "seed.applied",
      "organization",
      ORGANIZATION_ID,
      { companies: 12, open_findings: 47, verified_fixed: 126 },
      appliedAt,
    );

    return { applied: true };
  });
}
