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
const seedTime = "2026-08-20T12:00:00.000Z";
const organizationId = "org-harborline";
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
  logs: Array<Record<string, unknown>>;
  temporaryDirectory: string;
}

let fixture: Fixture;

function buildFixture(): Fixture {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "remedence-api-"));
  const database = openRemedenceDatabase({
    path: join(temporaryDirectory, "remedence.db"),
  });
  applyMigrations(database, migrationsDirectory);

  const clock = { now: () => seedTime };
  seedHarborline(database, { clock });

  const repositories = createRepositorySet(database, {
    referenceTime: seedTime,
  });
  const unitOfWork = createUnitOfWork(database, {
    referenceTime: seedTime,
  });
  let idSequence = 0;
  const idGenerator = {
    next: () => `api-test-${++idSequence}`,
  };
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
  const logs: Array<Record<string, unknown>> = [];
  const dependencies = {
    services,
    repositories,
    health: () => ({
      database: "ready" as const,
      schemaVersion: database.schemaVersion,
    }),
    log: (entry: Record<string, unknown>) => logs.push(entry),
  };

  return {
    app: createApp(dependencies),
    database,
    repositories,
    services,
    logs,
    temporaryDirectory,
  };
}

function validImport(findingKey = "SEC-9000") {
  return {
    company_id: "company-juniper-ridge-dental",
    finding_key: findingKey,
    title: "Imported API finding",
    description: "Created through the canonical local API.",
    source: "Manual",
    severity: "High",
    owner: "S. Patel",
    asset_name: "Patient Portal API",
    detected_at: "2026-08-20T10:00:00.000Z",
    sla_due_at: "2026-08-27T10:00:00.000Z",
  };
}

beforeEach(() => {
  fixture = buildFixture();
});

afterEach(() => {
  fixture.database.close();
  rmSync(fixture.temporaryDirectory, { recursive: true, force: true });
});

describe("Task 11 persisted API reads and imports", () => {
  it("reports database-backed health without exposing local paths", async () => {
    const response = await request(fixture.app).get("/healthz").expect(200);

    expect(response.body).toEqual({
      status: "ok",
      database: "ready",
      schema_version: 7,
    });
    expect(response.headers["x-request-id"]).toMatch(requestIdPattern);
    expect(JSON.stringify(response.body)).not.toMatch(/[A-Z]:\\\\|\/home\//);
  });

  it("derives dashboard metrics from the persistent seed", async () => {
    const response = await request(fixture.app)
      .get("/api/v1/dashboard")
      .expect(200);

    expect(response.body.metrics).toEqual({
      managed_companies: 12,
      open_findings: 47,
      awaiting_verification: 8,
      verification_failed: 3,
      verified_fixed: 126,
      sla_breaches: 4,
    });
    expect(response.body.action_queue[0].finding_key).toBe("SEC-1042");
  });

  it("filters finding reads by owner using persisted rows", async () => {
    const response = await request(fixture.app)
      .get("/api/v1/findings")
      .query({ owner: "S. Patel" })
      .expect(200);

    expect(response.body.items.length).toBeGreaterThan(0);
    expect(
      response.body.items.every(
        (finding: { owner: string; state: string }) =>
          finding.owner === "S. Patel" && finding.state !== "Verified fixed",
      ),
    ).toBe(true);
  });

  it("returns deterministic newest finding ordering", async () => {
    const first = await request(fixture.app)
      .get("/api/v1/findings")
      .query({ sort: "newest" })
      .expect(200);
    const second = await request(fixture.app)
      .get("/api/v1/findings")
      .query({ sort: "newest" })
      .expect(200);

    expect(
      first.body.items.map((finding: { id: string }) => finding.id),
    ).toEqual(second.body.items.map((finding: { id: string }) => finding.id));
    expect(first.body.items[0].finding_key).toBe("SEC-1081");
  });

  it("returns complete persisted finding detail for SEC-1042", async () => {
    const response = await request(fixture.app)
      .get("/api/v1/findings/SEC-1042")
      .expect(200);

    expect(response.body.finding).toMatchObject({
      finding_key: "SEC-1042",
      state: "Verification failed",
    });
    expect(response.body.company.name).toBe("Juniper Ridge Dental");
    expect(response.body.remediations).toHaveLength(1);
    expect(response.body.verifications).toHaveLength(1);
    expect(response.body.verifications[0]).toMatchObject({
      verification: {
        status: "Failed",
        result_summary: "Secondary query path remains vulnerable",
      },
    });
    expect(
      response.body.verifications[0].checks.some(
        (check: { status: string }) => check.status === "Failed",
      ),
    ).toBe(true);
    expect(Array.isArray(response.body.evidence)).toBe(true);
    expect(response.body.audit_events.length).toBeGreaterThan(0);
  });

  it("imports a finding through the real persistent service and appends audit history", async () => {
    const response = await request(fixture.app)
      .post("/api/v1/imports")
      .send(validImport())
      .expect(201);

    expect(response.headers.location).toBe(
      `/api/v1/findings/${response.body.finding.finding_key}`,
    );
    expect(response.body).toMatchObject({
      import_record: {
        source: "Manual",
      },
      finding: {
        finding_key: "SEC-9000",
        state: "Needs remediation",
      },
    });

    const reread = fixture.repositories.findings.findByKey(
      organizationId,
      "SEC-9000",
    );
    expect(reread?.id).toBe(response.body.finding.id);

    expect(reread).toBeDefined();
    if (!reread) throw new Error("Imported finding was not persisted.");

    const audit = fixture.repositories.auditEvents.list({
      organizationId,
      entityType: "finding",
      entityId: reread.id,
      page: 1,
      pageSize: 100,
    });
    expect(
      audit.items.some((event) => event.action === "finding.imported"),
    ).toBe(true);
  });

  it("persists offset import timestamps as canonical UTC", async () => {
    const response = await request(fixture.app)
      .post("/api/v1/imports")
      .send({
        ...validImport("SEC-OFFSET-UTC"),
        detected_at: "2026-08-20T23:30:00-02:00",
        sla_due_at: "2026-08-22T01:00:00+14:00",
      })
      .expect(201);

    expect(response.body.finding).toMatchObject({
      finding_key: "SEC-OFFSET-UTC",
      detected_at: "2026-08-21T01:30:00.000Z",
      sla_due_at: "2026-08-21T11:00:00.000Z",
    });

    const persisted = fixture.repositories.findings.findByKey(
      organizationId,
      "SEC-OFFSET-UTC",
    );
    expect(persisted).toMatchObject({
      detectedAt: "2026-08-21T01:30:00.000Z",
      slaDueAt: "2026-08-21T11:00:00.000Z",
    });
  });

  it("returns a stable conflict problem for case-variant duplicate imports", async () => {
    await request(fixture.app)
      .post("/api/v1/imports")
      .send(validImport("SEC-9000"))
      .expect(201);

    const response = await request(fixture.app)
      .post("/api/v1/imports")
      .send(validImport("sec-9000"))
      .expect(409);

    expect(response.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    );
    expect(response.body.code).toBe("DUPLICATE_FINDING");
    expect(response.body.status).toBe(409);
    expect(response.body.request_id).toBe(response.headers["x-request-id"]);
  });

  it("returns INVALID_REQUEST for an OpenAPI-invalid severity", async () => {
    const response = await request(fixture.app)
      .post("/api/v1/imports")
      .send({ ...validImport(), severity: "Urgent" })
      .expect(400);

    expect(response.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    );
    expect(response.body.code).toBe("INVALID_REQUEST");
    expect(response.body.errors.length).toBeGreaterThan(0);
  });

  it("returns REQUEST_TOO_LARGE for JSON bodies over 256 KiB", async () => {
    const response = await request(fixture.app)
      .post("/api/v1/imports")
      .send({
        ...validImport(),
        description: "x".repeat(256 * 1024),
      })
      .expect(413);

    expect(response.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    );
    expect(response.body.code).toBe("REQUEST_TOO_LARGE");
  });

  it("rejects non-JSON mutations as INVALID_REQUEST", async () => {
    const response = await request(fixture.app)
      .post("/api/v1/imports")
      .set("Content-Type", "text/plain")
      .send("{}")
      .expect(400);

    expect(response.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    );
    expect(response.body.code).toBe("INVALID_REQUEST");
  });

  it("includes a request ID on every successful and error response", async () => {
    const responses = await Promise.all([
      request(fixture.app).get("/healthz"),
      request(fixture.app).get("/api/v1/dashboard"),
      request(fixture.app)
        .post("/api/v1/imports")
        .send({ ...validImport(), severity: "Urgent" }),
    ]);

    for (const response of responses) {
      expect(response.headers["x-request-id"]).toMatch(requestIdPattern);
    }
  });

  it("preserves a valid caller request ID and logs the same ID", async () => {
    const response = await request(fixture.app)
      .get("/healthz")
      .set("X-Request-ID", "client.request-123")
      .expect(200);

    expect(response.headers["x-request-id"]).toBe("client.request-123");
    await new Promise((resolve) => setImmediate(resolve));
    expect(fixture.logs.at(-1)).toMatchObject({
      request_id: "client.request-123",
      method: "GET",
      path: "/healthz",
      status: 200,
    });
    expect(fixture.logs.at(-1)?.duration_ms).toEqual(expect.any(Number));
  });

  it("replaces an unsafe caller request ID", async () => {
    const response = await request(fixture.app)
      .get("/healthz")
      .set("X-Request-ID", "unsafe request id with spaces")
      .expect(200);

    expect(response.headers["x-request-id"]).toMatch(requestIdPattern);
    expect(response.headers["x-request-id"]).not.toBe(
      "unsafe request id with spaces",
    );
  });

  it("sanitizes unexpected server errors", async () => {
    const failingApp = createApp({
      services: {
        ...fixture.services,
        dashboard: {
          getDashboard() {
            throw new Error("C:\\private\\remedence.db token=do-not-leak");
          },
        },
      },
      repositories: fixture.repositories,
      health: () => ({ database: "ready" as const, schemaVersion: 1 }),
      log: () => undefined,
    });

    const response = await request(failingApp)
      .get("/api/v1/dashboard")
      .expect(500);

    expect(response.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    );
    expect(response.body.code).toBe("INTERNAL_ERROR");
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("remedence.db");
    expect(serialized).not.toContain("do-not-leak");
    expect(serialized).not.toContain("stack");
  });
});
