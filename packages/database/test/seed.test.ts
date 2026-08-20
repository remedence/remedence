import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RemedenceDatabase } from "../src/database.js";
import {
  getDatabaseConnection,
  openRemedenceDatabase,
} from "../src/database.js";
import { applyMigrations } from "../src/migrations.js";
import { createFindingRepository } from "../src/repositories/finding-repository.js";
import { seedHarborline } from "../src/seed.js";

const migrationsDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
const seedTime = "2026-08-20T12:00:00.000Z";
const runtime = {
  clock: {
    now: () => seedTime,
  },
};

let temporaryDirectory: string;
let database: RemedenceDatabase;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "remedence-seed-"));
  database = openRemedenceDatabase({
    path: join(temporaryDirectory, "remedence.db"),
  });
  applyMigrations(database, migrationsDirectory);
});

afterEach(() => {
  database.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function scalar(sql: string, ...parameters: string[]): number {
  const row = getDatabaseConnection(database)
    .prepare(sql)
    .get(...parameters) as Record<string, unknown> | undefined;
  const value = row?.value;
  if (typeof value !== "number") {
    throw new TypeError("Expected a numeric scalar result.");
  }
  return value;
}

describe("seedHarborline", () => {
  it("seeds the approved Harborline organization and exactly twelve companies", () => {
    expect(seedHarborline(database, runtime)).toEqual({ applied: true });

    expect(
      getDatabaseConnection(database)
        .prepare("SELECT id, name FROM organizations ORDER BY id")
        .all(),
    ).toEqual([
      {
        id: "org-harborline",
        name: "Harborline Technology Group",
      },
    ]);
    expect(scalar("SELECT COUNT(id) AS value FROM companies")).toBe(12);
    expect(
      getDatabaseConnection(database)
        .prepare(
          `SELECT name, risk_score, risk_level
           FROM companies
           WHERE id = ?`,
        )
        .get("company-juniper-ridge-dental"),
    ).toEqual({
      name: "Juniper Ridge Dental",
      risk_score: 82,
      risk_level: "High",
    });
  });

  it("matches the approved initial dashboard finding metrics", () => {
    seedHarborline(database, runtime);

    expect(
      scalar(
        `SELECT COUNT(id) AS value
         FROM findings
         WHERE state <> 'Verified fixed'`,
      ),
    ).toBe(47);
    expect(
      scalar(
        `SELECT COUNT(id) AS value
         FROM findings
         WHERE state = 'Awaiting verification'`,
      ),
    ).toBe(8);
    expect(
      scalar(
        `SELECT COUNT(id) AS value
         FROM findings
         WHERE state = 'Verification failed'`,
      ),
    ).toBe(3);
    expect(
      scalar(
        `SELECT COUNT(id) AS value
         FROM findings
         WHERE state = 'Verified fixed'`,
      ),
    ).toBe(126);

    const repository = createFindingRepository(database, {
      referenceTime: seedTime,
    });
    const openFindings = repository.list({
      organizationId: "org-harborline",
      sort: "priority",
      includeVerified: false,
      page: 1,
      pageSize: 100,
    });
    expect(
      openFindings.items.filter((finding) => finding.slaBreached),
    ).toHaveLength(4);
  });

  it("fully seeds the three approved featured company summaries", () => {
    seedHarborline(database, runtime);

    const counts = getDatabaseConnection(database)
      .prepare(
        `SELECT
           c.name,
           SUM(CASE WHEN f.state <> 'Verified fixed' THEN 1 ELSE 0 END) AS open,
           SUM(CASE WHEN f.state = 'Awaiting verification' THEN 1 ELSE 0 END) AS awaiting,
           SUM(CASE WHEN f.state = 'Verification failed' THEN 1 ELSE 0 END) AS failed
         FROM companies AS c
         LEFT JOIN findings AS f
           ON f.organization_id = c.organization_id AND f.company_id = c.id
         WHERE c.name IN (?, ?, ?)
         GROUP BY c.id, c.name
         ORDER BY c.name`,
      )
      .all("Alder & Pike Legal", "Cedarline Health", "Juniper Ridge Dental");

    expect(counts).toEqual([
      { name: "Alder & Pike Legal", open: 6, awaiting: 3, failed: 1 },
      { name: "Cedarline Health", open: 3, awaiting: 1, failed: 0 },
      { name: "Juniper Ridge Dental", open: 9, awaiting: 2, failed: 1 },
    ]);
  });

  it("starts SEC-1042 at failed verification #1 with the insufficient-patch history", () => {
    seedHarborline(database, runtime);
    const repository = createFindingRepository(database, {
      referenceTime: seedTime,
    });
    const detail = repository.getDetail("org-harborline", "SEC-1042");

    expect(detail?.company.name).toBe("Juniper Ridge Dental");
    expect(detail?.finding).toMatchObject({
      findingKey: "SEC-1042",
      title: "SQL injection in patient-export API",
      source: "Semgrep",
      severity: "Critical",
      state: "Verification failed",
      assetName: "Patient Portal API",
    });
    expect(detail?.remediations).toHaveLength(1);
    expect(detail?.remediations[0]).toMatchObject({
      status: "Completed",
      reference: "CHG-SEC-1042-1",
    });
    expect(detail?.verifications).toHaveLength(1);
    expect(detail?.verifications[0]).toMatchObject({
      status: "Failed",
      resultSummary: "Secondary query path remains vulnerable",
    });
    expect(
      detail?.verifications[0]?.checks.map((check) => check.status),
    ).toEqual(["Passed", "Failed"]);
    expect(detail?.verifications[0]?.checks[1]?.message).toMatch(
      /secondary query path remains vulnerable/i,
    );
  });

  it("does not pre-seed SEC-1042 remediation #2, a passed verification, or evidence", () => {
    seedHarborline(database, runtime);
    const detail = createFindingRepository(database, {
      referenceTime: seedTime,
    }).getDetail("org-harborline", "SEC-1042");

    expect(detail?.finding.state).toBe("Verification failed");
    expect(detail?.remediations).toHaveLength(1);
    expect(detail?.verifications.map((run) => run.status)).toEqual(["Failed"]);
    expect(detail?.evidence).toEqual([]);
  });

  it("gives every already-verified demo finding a passed verification and locked evidence", () => {
    seedHarborline(database, runtime);

    expect(
      scalar(
        `SELECT COUNT(f.id) AS value
         FROM findings AS f
         WHERE f.state = 'Verified fixed'
           AND NOT EXISTS (
             SELECT 1
             FROM evidence_items AS e
             JOIN verification_runs AS v ON v.id = e.verification_id
             WHERE e.finding_id = f.id
               AND e.locked_at IS NOT NULL
               AND v.status = 'Passed'
           )`,
      ),
    ).toBe(0);

    const sec1073 = createFindingRepository(database, {
      referenceTime: seedTime,
    }).getDetail("org-harborline", "SEC-1073");
    expect(sec1073?.finding.state).toBe("Verified fixed");
    expect(sec1073?.verifications.at(-1)?.status).toBe("Passed");
    expect(sec1073?.evidence.at(-1)?.lockedAt).not.toBeNull();
  });

  it("seeds a draft Juniper report and defensible audit events for the initial story", () => {
    seedHarborline(database, runtime);
    const connection = getDatabaseConnection(database);

    const reports = connection
      .prepare(
        `SELECT title, period_label, status, snapshot_json
         FROM reports
         WHERE company_id = ?
         ORDER BY generated_at, id`,
      )
      .all("company-juniper-ridge-dental") as Array<{
      title: string;
      period_label: string;
      status: string;
      snapshot_json: string;
    }>;
    expect(
      reports.map(({ snapshot_json: _snapshotJson, ...report }) => report),
    ).toEqual([
      {
        title: "Juniper Ridge Dental — August Security Review",
        period_label: "August 2026",
        status: "Draft",
      },
    ]);
    const snapshot = JSON.parse(reports[0]?.snapshot_json ?? "null") as {
      findings?: Array<{ findingKey: string; state: string }>;
      verificationHistory?: Array<{
        findingKey: string;
        status: string;
        checks: Array<{ status: string }>;
      }>;
    };
    expect(
      snapshot.findings?.find((finding) => finding.findingKey === "SEC-1042"),
    ).toMatchObject({
      state: "Verification failed",
    });
    expect(snapshot.verificationHistory).toEqual([
      expect.objectContaining({
        findingKey: "SEC-1042",
        status: "Failed",
        checks: [
          expect.objectContaining({ status: "Passed" }),
          expect.objectContaining({ status: "Failed" }),
        ],
      }),
    ]);

    expect(
      connection
        .prepare(
          `SELECT action
           FROM audit_events
           WHERE organization_id = ? AND entity_id = ?
           ORDER BY id`,
        )
        .all("org-harborline", "finding-sec-1042")
        .map((row) => (row as { action: string }).action),
    ).toEqual([
      "finding.imported",
      "remediation.completed",
      "verification.failed",
    ]);
  });

  it("is idempotent and does not duplicate any seeded rows", () => {
    expect(seedHarborline(database, runtime)).toEqual({ applied: true });
    const before = {
      organizations: scalar("SELECT COUNT(id) AS value FROM organizations"),
      companies: scalar("SELECT COUNT(id) AS value FROM companies"),
      findings: scalar("SELECT COUNT(id) AS value FROM findings"),
      evidence: scalar("SELECT COUNT(id) AS value FROM evidence_items"),
      audit: scalar("SELECT COUNT(id) AS value FROM audit_events"),
    };

    expect(seedHarborline(database, runtime)).toEqual({ applied: false });
    expect({
      organizations: scalar("SELECT COUNT(id) AS value FROM organizations"),
      companies: scalar("SELECT COUNT(id) AS value FROM companies"),
      findings: scalar("SELECT COUNT(id) AS value FROM findings"),
      evidence: scalar("SELECT COUNT(id) AS value FROM evidence_items"),
      audit: scalar("SELECT COUNT(id) AS value FROM audit_events"),
    }).toEqual(before);
  });

  it("refuses to overwrite any database that already contains an organization", () => {
    getDatabaseConnection(database)
      .prepare(
        `INSERT INTO organizations (id, name, slug, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        "org-existing",
        "Existing User Organization",
        "existing-user-organization",
        "2026-08-19T00:00:00.000Z",
        "2026-08-19T00:00:00.000Z",
      );

    expect(seedHarborline(database, runtime)).toEqual({ applied: false });
    expect(scalar("SELECT COUNT(id) AS value FROM organizations")).toBe(1);
    expect(scalar("SELECT COUNT(id) AS value FROM companies")).toBe(0);
    expect(scalar("SELECT COUNT(id) AS value FROM findings")).toBe(0);
    expect(
      getDatabaseConnection(database)
        .prepare("SELECT name FROM organizations WHERE id = ?")
        .get("org-existing"),
    ).toEqual({ name: "Existing User Organization" });
  });

  it("rolls back the complete seed if any insert fails", () => {
    getDatabaseConnection(database).exec(`
      CREATE TRIGGER test_fail_seed_company
      BEFORE INSERT ON companies
      WHEN NEW.id = 'company-alder-pike-legal'
      BEGIN
        SELECT RAISE(ABORT, 'forced seed failure');
      END;
    `);

    expect(() => seedHarborline(database, runtime)).toThrow(
      /forced seed failure/,
    );
    expect(scalar("SELECT COUNT(id) AS value FROM organizations")).toBe(0);
    expect(scalar("SELECT COUNT(id) AS value FROM companies")).toBe(0);
    expect(scalar("SELECT COUNT(id) AS value FROM findings")).toBe(0);
    expect(scalar("SELECT COUNT(id) AS value FROM audit_events")).toBe(0);
  });
});
