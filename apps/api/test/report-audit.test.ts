import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DashboardService,
  ImportFindingService,
  RemediationService,
  ReportService,
  VerificationService,
} from "@remedence/core";
import {
  applyMigrations,
  createRepositorySet,
  createUnitOfWork,
  openRemedenceDatabase,
  seedHarborline,
  type RemedenceDatabase,
} from "@remedence/database";
import { hashEvidenceMetadata } from "@remedence/evidence";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const migrationsDirectory = fileURLToPath(
  new URL("../../../packages/database/migrations", import.meta.url),
);
const now = "2026-08-20T12:00:00.000Z";
const organizationId = "org-harborline";
const companyId = "company-juniper-ridge-dental";
const requestIdPattern = /^[A-Za-z0-9._-]{1,80}$/;

interface Fixture {
  app: ReturnType<typeof createApp>;
  database: RemedenceDatabase;
  repositories: ReturnType<typeof createRepositorySet>;
  services: {
    dashboard: DashboardService;
    imports: ImportFindingService;
    remediation: RemediationService;
    verification: VerificationService;
    reports: ReportService;
  };
  temporaryDirectory: string;
}

let fixture: Fixture;

function buildFixture(): Fixture {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "remedence-task13-api-"),
  );
  const database = openRemedenceDatabase({
    path: join(temporaryDirectory, "remedence.db"),
  });
  applyMigrations(database, migrationsDirectory);

  const clock = { now: () => now };
  seedHarborline(database, { clock });
  const repositories = createRepositorySet(database, { referenceTime: now });
  const unitOfWork = createUnitOfWork(database, { referenceTime: now });
  let idSequence = 0;
  const idGenerator = { next: () => `task13-${++idSequence}` };
  const services = {
    dashboard: new DashboardService({ repositories }),
    imports: new ImportFindingService({ unitOfWork, clock, idGenerator }),
    remediation: new RemediationService({ unitOfWork, clock, idGenerator }),
    verification: new VerificationService({
      unitOfWork,
      clock,
      idGenerator,
      hashEvidence: hashEvidenceMetadata,
    }),
    reports: new ReportService({ unitOfWork, clock, idGenerator }),
  };

  return {
    app: createApp({
      services,
      repositories,
      health: () => ({
        database: "ready" as const,
        schemaVersion: database.schemaVersion,
      }),
      log: () => undefined,
    }),
    database,
    repositories,
    services,
    temporaryDirectory,
  };
}

function reportBody(periodLabel = "August") {
  return {
    company_id: companyId,
    period_label: periodLabel,
  };
}

function postSnapshotImportBody() {
  return {
    company_id: companyId,
    finding_key: "SEC-2999",
    title: "Post-snapshot API finding",
    description: "Created after report one to prove snapshot immutability.",
    source: "Manual",
    severity: "Medium",
    owner: "S. Patel",
    asset_name: "Patient Portal API",
    detected_at: "2026-08-20T11:00:00.000Z",
    sla_due_at: "2026-08-27T11:00:00.000Z",
  };
}

function expectIncreasingIds(items: Array<{ id: number }>): void {
  for (let index = 1; index < items.length; index += 1) {
    expect(items[index].id).toBeGreaterThan(items[index - 1].id);
  }
}

beforeEach(() => {
  fixture = buildFixture();
});

afterEach(() => {
  fixture.database.close();
  rmSync(fixture.temporaryDirectory, { recursive: true, force: true });
});

describe("Task 13 reports and audit reads", () => {
  it("creates, persists, and reads an immutable report snapshot", async () => {
    const created = await request(fixture.app)
      .post("/api/v1/reports")
      .send(reportBody())
      .expect(201);

    expect(created.headers["x-request-id"]).toMatch(requestIdPattern);
    expect(created.body).toMatchObject({
      company_id: companyId,
      period_label: "August",
      status: "Ready",
      snapshot: {
        company_name: "Juniper Ridge Dental",
        risk_score: 82,
      },
      generated_at: now,
      created_at: now,
    });
    expect(created.body.snapshot.findings.length).toBeGreaterThan(0);
    expect(
      created.body.snapshot.findings.some(
        (finding: { finding_key: string }) =>
          finding.finding_key === "SEC-1042",
      ),
    ).toBe(true);

    const reportId = created.body.id as string;
    expect(created.headers.location).toBe(`/api/v1/reports/${reportId}`);

    const persisted = fixture.repositories.reports.getById(
      organizationId,
      reportId,
    );
    expect(persisted).toBeDefined();
    expect(persisted?.snapshot.companyName).toBe("Juniper Ridge Dental");

    const audit = fixture.repositories.auditEvents.list({
      organizationId,
      entityType: "report",
      entityId: reportId,
      pageSize: 100,
    });
    expect(audit.items.map((event) => event.action)).toContain(
      "report.generated",
    );

    const detail = await request(fixture.app)
      .get(`/api/v1/reports/${reportId}`)
      .expect(200);
    expect(detail.headers["x-request-id"]).toMatch(requestIdPattern);
    expect(detail.body).toEqual(created.body);
  });

  it("keeps report one immutable when live state changes and report two is created", async () => {
    const first = await request(fixture.app)
      .post("/api/v1/reports")
      .send(reportBody())
      .expect(201);
    const firstId = first.body.id as string;
    const firstSnapshot = structuredClone(first.body.snapshot);

    await request(fixture.app)
      .post("/api/v1/imports")
      .send(postSnapshotImportBody())
      .expect(201);

    const second = await request(fixture.app)
      .post("/api/v1/reports")
      .send(reportBody())
      .expect(201);
    const secondId = second.body.id as string;

    expect(secondId).not.toBe(firstId);
    expect(second.body.snapshot.findings.length).toBe(
      firstSnapshot.findings.length + 1,
    );
    expect(
      second.body.snapshot.findings.some(
        (finding: { finding_key: string }) =>
          finding.finding_key === "SEC-2999",
      ),
    ).toBe(true);

    const firstReread = await request(fixture.app)
      .get(`/api/v1/reports/${firstId}`)
      .expect(200);
    expect(firstReread.body.snapshot).toEqual(firstSnapshot);
    expect(
      firstReread.body.snapshot.findings.some(
        (finding: { finding_key: string }) =>
          finding.finding_key === "SEC-2999",
      ),
    ).toBe(false);
  });

  it("downloads Markdown from the stored snapshot with a deterministic safe filename", async () => {
    const created = await request(fixture.app)
      .post("/api/v1/reports")
      .send(reportBody())
      .expect(201);
    const reportId = created.body.id as string;

    await request(fixture.app)
      .post("/api/v1/imports")
      .send(postSnapshotImportBody())
      .expect(201);

    const download = await request(fixture.app)
      .get(`/api/v1/reports/${reportId}/download`)
      .expect(200);

    expect(download.headers["x-request-id"]).toMatch(requestIdPattern);
    expect(download.headers["content-type"]).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(download.headers["content-disposition"]).toBe(
      'attachment; filename="juniper-ridge-dental-august-security-review.md"',
    );
    expect(download.text).toContain(
      "# Juniper Ridge Dental — August Security Review",
    );
    expect(download.text).toContain("Period: August");
    expect(download.text).toContain("Risk score: 82");
    expect(download.text).toMatch(/Verified fixes:\s+\d+/);
    expect(download.text).toContain("Failed verification history");
    expect(download.text).toContain(`Generated: ${now}`);
    expect(download.text).not.toContain("Post-snapshot API finding");
  });

  it("sanitizes report filenames derived from persisted period labels", async () => {
    const created = await request(fixture.app)
      .post("/api/v1/reports")
      .send(reportBody("August/../C:\\temp\r\nInjected: yes"))
      .expect(201);
    const reportId = created.body.id as string;

    const download = await request(fixture.app)
      .get(`/api/v1/reports/${reportId}/download`)
      .expect(200);
    const disposition = String(download.headers["content-disposition"]);

    expect(disposition).toMatch(
      /^attachment; filename="[a-z0-9-]+-security-review\.md"$/,
    );
    expect(disposition).not.toMatch(/[\\/\r\n]/);
    expect(disposition).not.toContain("..");
    expect(disposition).not.toContain(":");
  });

  it("lists ordered audit events with entity, time, and pagination filters", async () => {
    const firstReport = await request(fixture.app)
      .post("/api/v1/reports")
      .send(reportBody())
      .expect(201);
    const secondReport = await request(fixture.app)
      .post("/api/v1/reports")
      .send(reportBody("September"))
      .expect(201);

    const all = await request(fixture.app)
      .get("/api/v1/audit-events")
      .query({ page_size: 100 })
      .expect(200);
    expect(all.headers["x-request-id"]).toMatch(requestIdPattern);
    expect(all.body).toMatchObject({ page_size: 100 });
    expect(all.body.total).toBeGreaterThanOrEqual(all.body.items.length);
    expectIncreasingIds(all.body.items);
    expect(
      all.body.items.every(
        (event: { organization_id: string }) =>
          event.organization_id === organizationId,
      ),
    ).toBe(true);

    const reportEvents = await request(fixture.app)
      .get("/api/v1/audit-events")
      .query({ entity_type: "report", page_size: 100 })
      .expect(200);
    expect(
      reportEvents.body.items.some(
        (event: { entity_id: string }) =>
          event.entity_id === firstReport.body.id,
      ),
    ).toBe(true);
    expect(
      reportEvents.body.items.some(
        (event: { entity_id: string }) =>
          event.entity_id === secondReport.body.id,
      ),
    ).toBe(true);
    expect(
      reportEvents.body.items.every(
        (event: { entity_type: string }) => event.entity_type === "report",
      ),
    ).toBe(true);

    const oneReport = await request(fixture.app)
      .get("/api/v1/audit-events")
      .query({
        entity_type: "report",
        entity_id: firstReport.body.id,
        page_size: 100,
      })
      .expect(200);
    expect(oneReport.body.items).toHaveLength(1);
    expect(oneReport.body.items[0]).toMatchObject({
      action: "report.generated",
      entity_type: "report",
      entity_id: firstReport.body.id,
      occurred_at: now,
    });

    const timeFiltered = await request(fixture.app)
      .get("/api/v1/audit-events")
      .query({
        entity_type: "report",
        from: "2026-08-20T11:59:59.000Z",
        to: "2026-08-20T12:00:01.000Z",
        page_size: 100,
      })
      .expect(200);
    expect(timeFiltered.body.items).toHaveLength(2);
    expect(
      timeFiltered.body.items.every(
        (event: { occurred_at: string }) => event.occurred_at === now,
      ),
    ).toBe(true);

    const firstPage = await request(fixture.app)
      .get("/api/v1/audit-events")
      .query({ page_size: 2 })
      .expect(200);
    const secondPage = await request(fixture.app)
      .get("/api/v1/audit-events")
      .query({ cursor: firstPage.body.next_cursor, page_size: 2 })
      .expect(200);
    expect(firstPage.body).toMatchObject({ page_size: 2 });
    expect(secondPage.body).toMatchObject({ page_size: 2 });
    expect(firstPage.body.total).toBe(secondPage.body.total);
    expect(firstPage.body.items).toHaveLength(2);
    expect(secondPage.body.items).toHaveLength(2);
    expect(firstPage.body.items[1].id).toBeLessThan(
      secondPage.body.items[0].id,
    );
  });

  it("keeps organization selection server-side and returns sanitized report errors", async () => {
    const unknownReport = await request(fixture.app)
      .get("/api/v1/reports/report-does-not-exist")
      .expect(404);
    expect(unknownReport.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    );
    expect(unknownReport.body.code).toBe("REPORT_NOT_FOUND");

    const unknownCompany = await request(fixture.app)
      .post("/api/v1/reports")
      .send({ company_id: "company-does-not-exist", period_label: "August" })
      .expect(404);
    expect(unknownCompany.body.code).toBe("COMPANY_NOT_FOUND");

    const invalidReport = await request(fixture.app)
      .post("/api/v1/reports")
      .send({ company_id: companyId })
      .expect(400);
    expect(invalidReport.body.code).toBe("INVALID_REQUEST");

    const callerOrganization = await request(fixture.app)
      .get("/api/v1/audit-events")
      .query({ organization_id: "org-not-local" })
      .expect(400);
    expect(callerOrganization.body.code).toBe("INVALID_REQUEST");
  });
});
