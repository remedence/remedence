import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findingPriorityBucket, type FindingQuery } from "@remedence/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RemedenceDatabase } from "../src/database.js";
import {
  getDatabaseConnection,
  openRemedenceDatabase,
} from "../src/database.js";
import { applyMigrations } from "../src/migrations.js";
import { createFindingRepository } from "../src/repositories/finding-repository.js";

const migrationsDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
const referenceTime = "2026-08-20T12:00:00.000Z";

let temporaryDirectory: string;
let database: RemedenceDatabase;

interface FindingFixture {
  id: string;
  organizationId?: string;
  companyId: string;
  findingKey: string;
  title: string;
  source: string;
  severity: "Critical" | "High" | "Medium" | "Low" | "Info";
  state:
    | "Needs remediation"
    | "Remediating"
    | "Awaiting verification"
    | "Verification failed"
    | "Verified fixed";
  owner: string;
  assetName: string;
  detectedAt: string;
  slaDueAt: string;
}

function insertFinding(fixture: FindingFixture): void {
  getDatabaseConnection(database)
    .prepare(
      `INSERT INTO findings (
         id, organization_id, company_id, finding_key, title, description,
         source, severity, state, owner, asset_name, detected_at, sla_due_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fixture.id,
      fixture.organizationId ?? "org-harborline",
      fixture.companyId,
      fixture.findingKey,
      fixture.title,
      `${fixture.title} description`,
      fixture.source,
      fixture.severity,
      fixture.state,
      fixture.owner,
      fixture.assetName,
      fixture.detectedAt,
      fixture.slaDueAt,
      fixture.detectedAt,
      fixture.detectedAt,
    );
}

function query(overrides: Partial<FindingQuery> = {}): FindingQuery {
  return {
    organizationId: "org-harborline",
    sort: "priority",
    includeVerified: false,
    page: 1,
    pageSize: 25,
    ...overrides,
  };
}

beforeEach(() => {
  temporaryDirectory = mkdtempSync(
    join(tmpdir(), "remedence-finding-repository-"),
  );
  database = openRemedenceDatabase({
    path: join(temporaryDirectory, "remedence.db"),
  });
  applyMigrations(database, migrationsDirectory);

  const connection = getDatabaseConnection(database);
  const insertOrganization = connection.prepare(
    `INSERT INTO organizations (id, name, slug, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  insertOrganization.run(
    "org-harborline",
    "Harborline Technology Group",
    "harborline",
    "2026-08-01T00:00:00.000Z",
    "2026-08-01T00:00:00.000Z",
  );
  insertOrganization.run(
    "org-other",
    "Other Organization",
    "other",
    "2026-08-01T00:00:00.000Z",
    "2026-08-01T00:00:00.000Z",
  );

  const insertCompany = connection.prepare(
    `INSERT INTO companies (
       id, organization_id, name, risk_score, risk_level, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insertCompany.run(
    "company-juniper",
    "org-harborline",
    "Juniper Ridge Dental",
    82,
    "Critical",
    "2026-08-01T00:00:00.000Z",
    "2026-08-01T00:00:00.000Z",
  );
  insertCompany.run(
    "company-acme",
    "org-harborline",
    "Acme Financial",
    70,
    "High",
    "2026-08-01T00:00:00.000Z",
    "2026-08-01T00:00:00.000Z",
  );
  insertCompany.run(
    "company-zeta",
    "org-harborline",
    "Zeta Legal",
    50,
    "Medium",
    "2026-08-01T00:00:00.000Z",
    "2026-08-01T00:00:00.000Z",
  );
  insertCompany.run(
    "company-other",
    "org-other",
    "Other Company",
    10,
    "Low",
    "2026-08-01T00:00:00.000Z",
    "2026-08-01T00:00:00.000Z",
  );

  insertFinding({
    id: "finding-failed",
    companyId: "company-juniper",
    findingKey: "SEC-1042",
    title: "Critical SQL injection",
    source: "Semgrep",
    severity: "Critical",
    state: "Verification failed",
    owner: "L. Chen",
    assetName: "Patient Portal API",
    detectedAt: "2026-08-10T10:00:00.000Z",
    slaDueAt: "2026-08-11T10:00:00.000Z",
  });
  insertFinding({
    id: "finding-awaiting-critical",
    companyId: "company-acme",
    findingKey: "SEC-1081",
    title: "Critical access control gap",
    source: "Snyk",
    severity: "Critical",
    state: "Awaiting verification",
    owner: "R. Singh",
    assetName: "Core API",
    detectedAt: "2026-08-18T10:00:00.000Z",
    slaDueAt: "2026-08-25T10:00:00.000Z",
  });
  insertFinding({
    id: "finding-breached",
    companyId: "company-zeta",
    findingKey: "SEC-1058",
    title: "Weak session invalidation",
    source: "Manual",
    severity: "Medium",
    state: "Remediating",
    owner: "M. Ortiz",
    assetName: "Partner Portal",
    detectedAt: "2026-08-12T10:00:00.000Z",
    slaDueAt: "2026-08-15T10:00:00.000Z",
  });
  insertFinding({
    id: "finding-high",
    companyId: "company-juniper",
    findingKey: "SEC-1067",
    title: "High privilege exposure",
    source: "Burp Suite",
    severity: "High",
    state: "Needs remediation",
    owner: "A. Brooks",
    assetName: "Admin Console",
    detectedAt: "2026-08-16T10:00:00.000Z",
    slaDueAt: "2026-08-24T10:00:00.000Z",
  });
  insertFinding({
    id: "finding-open",
    companyId: "company-acme",
    findingKey: "SEC-1090",
    title: "Medium logging gap",
    source: "Manual",
    severity: "Medium",
    state: "Awaiting verification",
    owner: "S. Patel",
    assetName: "Audit Service",
    detectedAt: "2026-08-19T09:00:00.000Z",
    slaDueAt: "2026-08-26T10:00:00.000Z",
  });
  insertFinding({
    id: "finding-literal",
    companyId: "company-acme",
    findingKey: "SEC-1100",
    title: "Literal 100%_coverage marker",
    source: "Manual",
    severity: "Low",
    state: "Needs remediation",
    owner: "S. Patel",
    assetName: "Coverage Dashboard",
    detectedAt: "2026-08-19T09:00:00.000Z",
    slaDueAt: "2026-08-27T10:00:00.000Z",
  });
  insertFinding({
    id: "finding-verified",
    companyId: "company-juniper",
    findingKey: "SEC-1073",
    title: "Resolved cross-site scripting",
    source: "Semgrep",
    severity: "Critical",
    state: "Verified fixed",
    owner: "S. Patel",
    assetName: "Public Portal",
    detectedAt: "2026-08-17T10:00:00.000Z",
    slaDueAt: "2026-08-18T10:00:00.000Z",
  });
  insertFinding({
    id: "finding-other-org",
    organizationId: "org-other",
    companyId: "company-other",
    findingKey: "SEC-1042",
    title: "Other organization SQL injection",
    source: "Other Scanner",
    severity: "Critical",
    state: "Needs remediation",
    owner: "Other Owner",
    assetName: "Other API",
    detectedAt: "2026-08-01T10:00:00.000Z",
    slaDueAt: "2026-08-30T10:00:00.000Z",
  });

  const insertRemediation = connection.prepare(
    `INSERT INTO remediations (
       organization_id, id, finding_id, status, summary, reference, owner, started_at,
       completed_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertRemediation.run(
    "org-harborline",
    "remediation-1",
    "finding-failed",
    "Completed",
    "Patched primary query path",
    "CHG-1042-1",
    "L. Chen",
    "2026-08-11T00:00:00.000Z",
    "2026-08-11T06:00:00.000Z",
    "2026-08-11T00:00:00.000Z",
    "2026-08-11T06:00:00.000Z",
  );
  connection
    .prepare(
      `INSERT INTO verification_runs (
         organization_id, id, finding_id, remediation_id, status, method, worker_name, scope,
         result_summary, started_at, completed_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "org-harborline",
      "verification-1",
      "finding-failed",
      "remediation-1",
      "Failed",
      "Independent manual retest",
      "Operator",
      "Patient Portal API",
      "Secondary query path remains vulnerable",
      "2026-08-12T00:00:00.000Z",
      "2026-08-12T00:10:00.000Z",
      "2026-08-12T00:00:00.000Z",
    );
  const insertCheck = connection.prepare(
    `INSERT INTO verification_checks (
       organization_id, id, verification_id, sequence, name, status, message, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertCheck.run(
    "org-harborline",
    "check-1",
    "verification-1",
    1,
    "Primary query path",
    "Passed",
    "Primary path no longer injectable",
    "2026-08-12T00:05:00.000Z",
  );
  insertCheck.run(
    "org-harborline",
    "check-2",
    "verification-1",
    2,
    "Secondary query path",
    "Failed",
    "Secondary path remains vulnerable",
    "2026-08-12T00:06:00.000Z",
  );
  connection
    .prepare(
      `INSERT INTO audit_events (
         organization_id, actor_type, actor_id, action, entity_type, entity_id,
         details_json, occurred_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "org-harborline",
      "operator",
      "local-user",
      "verification.failed",
      "finding",
      "finding-failed",
      '{"summary":"secondary query path remains vulnerable"}',
      "2026-08-12T00:10:00.000Z",
    );
});

afterEach(() => {
  database.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("FindingRepository", () => {
  it("finds finding keys case-insensitively within one organization", () => {
    const repository = createFindingRepository(database, { referenceTime });

    expect(repository.findByKey("org-harborline", "SEC-1042")?.id).toBe(
      "finding-failed",
    );
    expect(repository.findByKey("org-harborline", "sec-1042")?.id).toBe(
      "finding-failed",
    );
    expect(repository.findByKey("org-other", "SEC-1067")).toBeUndefined();
  });

  it.each([
    ["sec-1042", "finding key"],
    ["sql injection", "title"],
    ["juniper ridge", "company name"],
    ["semgrep", "source"],
    ["l. chen", "owner"],
    ["patient portal", "asset name"],
  ])("searches %s through the approved %s field", (search) => {
    const repository = createFindingRepository(database, { referenceTime });
    const result = repository.list(query({ search }));
    expect(result.items.map((finding) => finding.id)).toContain(
      "finding-failed",
    );
  });

  it("treats percent and underscore search characters literally", () => {
    const repository = createFindingRepository(database, { referenceTime });
    const result = repository.list(query({ search: "%_" }));
    expect(result.items.map((finding) => finding.id)).toEqual([
      "finding-literal",
    ]);
  });

  it("applies owner, state, severity, and company filters", () => {
    const repository = createFindingRepository(database, { referenceTime });

    expect(
      repository.list(query({ owner: "A. Brooks" })).items.map((x) => x.id),
    ).toEqual(["finding-high"]);
    expect(
      repository
        .list(query({ state: "Verification failed" }))
        .items.map((x) => x.id),
    ).toEqual(["finding-failed"]);
    expect(
      repository.list(query({ severity: "High" })).items.map((x) => x.id),
    ).toEqual(["finding-high"]);
    expect(
      repository
        .list(query({ companyId: "company-zeta" }))
        .items.map((x) => x.id),
    ).toEqual(["finding-breached"]);
  });

  it("excludes verified findings by default and includes them explicitly", () => {
    const repository = createFindingRepository(database, { referenceTime });

    expect(
      repository.list(query()).items.map((finding) => finding.id),
    ).not.toContain("finding-verified");
    expect(
      repository
        .list(query({ includeVerified: true }))
        .items.map((finding) => finding.id),
    ).toContain("finding-verified");
  });

  it("orders the six priority buckets consistently with core", () => {
    const repository = createFindingRepository(database, { referenceTime });
    const result = repository.list(query({ includeVerified: true }));

    expect(result.items.slice(0, 6).map((finding) => finding.id)).toEqual([
      "finding-failed",
      "finding-awaiting-critical",
      "finding-breached",
      "finding-high",
      "finding-open",
      "finding-literal",
    ]);
    expect(result.items.at(-1)?.id).toBe("finding-verified");
    for (const finding of result.items) {
      expect(finding.priorityBucket).toBe(findingPriorityBucket(finding));
    }
  });

  it("orders newest deterministically by detected time then finding key", () => {
    const repository = createFindingRepository(database, { referenceTime });
    const result = repository.list(query({ sort: "newest" }));

    expect(
      result.items.slice(0, 3).map((finding) => finding.findingKey),
    ).toEqual(["SEC-1090", "SEC-1100", "SEC-1081"]);
  });

  it("orders SLA deterministically with breached rows first", () => {
    const repository = createFindingRepository(database, { referenceTime });
    const result = repository.list(query({ sort: "sla" }));

    expect(result.items.slice(0, 2).map((finding) => finding.id)).toEqual([
      "finding-failed",
      "finding-breached",
    ]);
    expect(result.items[0]?.slaBreached).toBe(true);
    expect(result.items[1]?.slaBreached).toBe(true);
  });

  it("returns deterministic pagination metadata and an empty page past the end", () => {
    const repository = createFindingRepository(database, { referenceTime });
    const page = repository.list(query({ page: 2, pageSize: 2 }));

    expect(page).toMatchObject({ page: 2, pageSize: 2, total: 6 });
    expect(page.items.map((finding) => finding.id)).toEqual([
      "finding-breached",
      "finding-high",
    ]);

    expect(repository.list(query({ page: 99, pageSize: 2 }))).toMatchObject({
      items: [],
      page: 99,
      pageSize: 2,
      total: 6,
    });
  });

  it("never returns another organization's rows from list queries", () => {
    const repository = createFindingRepository(database, { referenceTime });
    expect(repository.list(query({ search: "Other" })).items).toEqual([]);
  });

  it("exposes company name, SLA breach state, and priority bucket on queue rows", () => {
    const repository = createFindingRepository(database, { referenceTime });
    const failed = repository.list(query({ search: "SEC-1042" })).items[0];

    expect(failed).toMatchObject({
      companyName: "Juniper Ridge Dental",
      slaBreached: true,
      priorityBucket: 1,
    });
  });

  it("preserves earlier failed verification history after a later pass", () => {
    const connection = getDatabaseConnection(database);
    connection
      .prepare(
        `INSERT INTO remediations (
           organization_id, id, finding_id, status, summary, reference, owner, started_at,
           completed_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "org-harborline",
        "remediation-2",
        "finding-failed",
        "Completed",
        "Patched secondary query path",
        "CHG-1042-2",
        "L. Chen",
        "2026-08-13T00:00:00.000Z",
        "2026-08-13T06:00:00.000Z",
        "2026-08-13T00:00:00.000Z",
        "2026-08-13T06:00:00.000Z",
      );
    connection
      .prepare(
        `INSERT INTO verification_runs (
           organization_id, id, finding_id, remediation_id, status, method, worker_name, scope,
           result_summary, started_at, completed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "org-harborline",
        "verification-2",
        "finding-failed",
        "remediation-2",
        "Passed",
        "Independent manual retest",
        "Operator",
        "Patient Portal API",
        "Both query paths resist injection",
        "2026-08-14T00:00:00.000Z",
        "2026-08-14T00:10:00.000Z",
        "2026-08-14T00:00:00.000Z",
      );
    connection
      .prepare(
        `INSERT INTO verification_checks (
           organization_id, id, verification_id, sequence, name, status, message, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "org-harborline",
        "check-3",
        "verification-2",
        1,
        "Primary and secondary query paths",
        "Passed",
        "No injection reproduced",
        "2026-08-14T00:05:00.000Z",
      );
    connection
      .prepare(
        `INSERT INTO evidence_items (
           organization_id, id, finding_id, verification_id, kind, label, source_reference,
           content_hash, metadata_json, created_at, locked_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "org-harborline",
        "evidence-2",
        "finding-failed",
        "verification-2",
        "verification-result",
        "Passed retest",
        "verification://verification-2",
        "a".repeat(64),
        '{"paths":2}',
        "2026-08-14T00:10:00.000Z",
        "2026-08-14T00:10:00.000Z",
      );
    connection
      .prepare("UPDATE findings SET state = ?, updated_at = ? WHERE id = ?")
      .run("Verified fixed", "2026-08-14T00:10:00.000Z", "finding-failed");

    const repository = createFindingRepository(database, { referenceTime });
    const detail = repository.getDetail("org-harborline", "SEC-1042");

    expect(detail?.verifications.map((run) => run.status)).toEqual([
      "Failed",
      "Passed",
    ]);
    expect(
      detail?.verifications[0]?.checks.map((check) => check.status),
    ).toEqual(["Passed", "Failed"]);
    expect(
      detail?.verifications[1]?.checks.map((check) => check.status),
    ).toEqual(["Passed"]);
    expect(detail?.evidence).toHaveLength(1);
    expect(detail?.auditEvents).toHaveLength(1);
  });

  it("returns undefined detail when the organization does not own the finding", () => {
    const repository = createFindingRepository(database, { referenceTime });
    expect(repository.getDetail("org-other", "SEC-1067")).toBeUndefined();
  });

  it("implements minimal prepared insert and state update operations", () => {
    const repository = createFindingRepository(database, { referenceTime });
    repository.insert({
      id: "finding-inserted",
      organizationId: "org-harborline",
      companyId: "company-juniper",
      findingKey: "SEC-1200",
      title: "Inserted finding",
      description: "Inserted through repository",
      source: "Manual",
      severity: "Low",
      state: "Needs remediation",
      owner: "L. Chen",
      assetName: "Test Asset",
      detectedAt: "2026-08-20T10:00:00.000Z",
      slaDueAt: "2026-08-30T10:00:00.000Z",
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-20T10:00:00.000Z",
      version: 1,
    });
    repository.updateState(
      "org-harborline",
      "finding-inserted",
      "Needs remediation",
      "Remediating",
      "2026-08-20T11:00:00.000Z",
    );

    expect(repository.findByKey("org-harborline", "SEC-1200")).toMatchObject({
      state: "Remediating",
      updatedAt: "2026-08-20T11:00:00.000Z",
    });
  });

  it("rejects invalid pagination and unsupported sort values at runtime", () => {
    const repository = createFindingRepository(database, { referenceTime });
    expect(() => repository.list(query({ page: 0 }))).toThrow(/page/);
    expect(() => repository.list(query({ pageSize: 101 }))).toThrow(/pageSize/);
    expect(() =>
      repository.list({ ...query(), sort: "unsafe" as FindingQuery["sort"] }),
    ).toThrow(/sort/);
  });
});
