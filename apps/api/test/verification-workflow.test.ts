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
  type Remediation,
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
const requestIdPattern = /^[A-Za-z0-9._-]{1,80}$/;
const expectedChecks = [
  "Primary vulnerable query path rejected",
  "Secondary query path rejected",
  "Regression coverage passes",
] as const;

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
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "remedence-task12-"));
  const database = openRemedenceDatabase({
    path: join(temporaryDirectory, "remedence.db"),
  });
  applyMigrations(database, migrationsDirectory);

  const clock = { now: () => now };
  seedHarborline(database, { clock });
  const repositories = createRepositorySet(database, { referenceTime: now });
  const unitOfWork = createUnitOfWork(database, { referenceTime: now });
  let idSequence = 0;
  const idGenerator = { next: () => `task12-${++idSequence}` };
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

function importBody() {
  return {
    company_id: "company-juniper-ridge-dental",
    finding_key: "SEC-2099",
    title: "Secondary query authorization bypass",
    description:
      "Authorization controls differ between equivalent query paths.",
    source: "Manual",
    severity: "High",
    owner: "S. Patel",
    asset_name: "Patient Portal API",
    detected_at: "2026-08-20T10:00:00.000Z",
    sla_due_at: "2026-08-27T10:00:00.000Z",
  };
}

function remediationBody(findingId: string, attempt: number) {
  return {
    finding_id: findingId,
    owner: "S. Patel",
    summary: `Remediation attempt ${attempt} closes the affected query paths.`,
    reference: `change://SEC-2099/remediation-${attempt}`,
  };
}

function verificationBody(
  findingId: string,
  remediationId: string,
  attempt: number,
) {
  return {
    finding_id: findingId,
    remediation_id: remediationId,
    method: "Operator-recorded authorization retest",
    worker_name: "local-independent-verifier",
    scope: `SEC-2099 remediation attempt ${attempt} query and regression paths`,
    checks: [...expectedChecks],
  };
}

function auditActions(entityType: string, entityId: string): string[] {
  return fixture.repositories.auditEvents
    .list({
      organizationId,
      entityType,
      entityId,
      page: 1,
      pageSize: 100,
    })
    .items.map((event) => event.action);
}

beforeEach(() => {
  fixture = buildFixture();
});

afterEach(() => {
  fixture.database.close();
  rmSync(fixture.temporaryDirectory, { recursive: true, force: true });
});

describe("Task 12 remediation, verification, and evidence workflow", () => {
  it("rejects the persisted remediation owner as verifier without partial state", async () => {
    const imported = await request(fixture.app)
      .post("/api/v1/imports")
      .send(importBody())
      .expect(201);
    const findingId = imported.body.finding.id as string;
    const remediation = await request(fixture.app)
      .post("/api/v1/remediations")
      .send(remediationBody(findingId, 1))
      .expect(201);
    const remediationId = remediation.body.id as string;
    await request(fixture.app)
      .post(`/api/v1/remediations/${remediationId}/complete`)
      .send({ summary: "Ready for review.", reference: "change://complete" })
      .expect(200);

    const rejected = await request(fixture.app)
      .post("/api/v1/verifications")
      .send({
        ...verificationBody(findingId, remediationId, 1),
        worker_name: " s. PATEL ",
      })
      .expect(409);

    expect(rejected.body).toMatchObject({
      status: 409,
      code: "VERIFIER_NOT_INDEPENDENT",
    });
    expect(
      fixture.repositories.verifications.listByFinding(
        organizationId,
        findingId,
      ),
    ).toEqual([]);
  });

  it("persists a failed verification before a later evidence-backed verified fix", async () => {
    const imported = await request(fixture.app)
      .post("/api/v1/imports")
      .send(importBody())
      .expect(201);

    expect(imported.headers.location).toBe("/api/v1/findings/SEC-2099");
    expect(imported.body.finding.state).toBe("Needs remediation");
    const findingId = imported.body.finding.id as string;
    expect(auditActions("finding", findingId)).toContain("finding.imported");

    const remediation1 = await request(fixture.app)
      .post("/api/v1/remediations")
      .send(remediationBody(findingId, 1))
      .expect(201);
    const remediation1Id = remediation1.body.id as string;

    expect(remediation1.body.status).toBe("In progress");
    expect(remediation1.headers["x-request-id"]).toMatch(requestIdPattern);
    expect(remediation1.headers.location).toBe(
      `/api/v1/remediations/${remediation1Id}`,
    );
    expect(
      fixture.repositories.findings.getById(organizationId, findingId)?.state,
    ).toBe("Remediating");
    expect(auditActions("remediation", remediation1Id)).toContain(
      "remediation.started",
    );

    const completedRemediation1 = await request(fixture.app)
      .post(`/api/v1/remediations/${remediation1Id}/complete`)
      .send({
        summary:
          "Primary authorization path patched; ready for independent retest.",
        reference: "change://SEC-2099/remediation-1-complete",
      })
      .expect(200);

    expect(completedRemediation1.body.status).toBe("Completed");
    expect(
      fixture.repositories.findings.getById(organizationId, findingId)?.state,
    ).toBe("Awaiting verification");
    expect(auditActions("remediation", remediation1Id)).toContain(
      "remediation.completed",
    );

    const verification1 = await request(fixture.app)
      .post("/api/v1/verifications")
      .send(verificationBody(findingId, remediation1Id, 1))
      .expect(201);
    const verification1Id = verification1.body.verification.id as string;

    expect(verification1.body.verification.status).toBe("Running");
    expect(verification1.headers["x-request-id"]).toMatch(requestIdPattern);
    expect(verification1.body.checks).toHaveLength(3);
    expect(
      verification1.body.checks.map(
        (check: { sequence: number }) => check.sequence,
      ),
    ).toEqual([1, 2, 3]);
    expect(
      verification1.body.checks.every(
        (check: { status: string }) => check.status === "Pending",
      ),
    ).toBe(true);
    expect(verification1.headers.location).toBe(
      `/api/v1/verifications/${verification1Id}`,
    );
    expect(auditActions("verification", verification1Id)).toContain(
      "verification.started",
    );

    const passedCheck = await request(fixture.app)
      .post(`/api/v1/verifications/${verification1Id}/checks`)
      .send({
        sequence: 1,
        name: expectedChecks[0],
        status: "Passed",
        message:
          "Primary vulnerable path now rejects the unauthorized request.",
      })
      .expect(201);
    expect(passedCheck.body).toMatchObject({
      sequence: 1,
      name: expectedChecks[0],
      status: "Passed",
    });

    const duplicateCheck = await request(fixture.app)
      .post(`/api/v1/verifications/${verification1Id}/checks`)
      .send({
        sequence: 1,
        name: expectedChecks[0],
        status: "Passed",
        message: "Duplicate recording attempt.",
      })
      .expect(409);
    expect(duplicateCheck.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    );
    expect(duplicateCheck.body.code).toBe("CONCURRENT_STATE_CHANGE");
    expect(duplicateCheck.body.request_id).toBe(
      duplicateCheck.headers["x-request-id"],
    );

    const failedCheck = await request(fixture.app)
      .post(`/api/v1/verifications/${verification1Id}/checks`)
      .send({
        sequence: 2,
        name: expectedChecks[1],
        status: "Failed",
        message:
          "Secondary query path still returns data without the required authorization.",
      })
      .expect(201);
    expect(failedCheck.body).toMatchObject({
      sequence: 2,
      name: expectedChecks[1],
      status: "Failed",
    });

    await request(fixture.app)
      .post(`/api/v1/verifications/${verification1Id}/checks`)
      .send({
        sequence: 3,
        name: expectedChecks[2],
        status: "Skipped",
        message:
          "Regression suite deferred because the secondary path still fails.",
      })
      .expect(201);

    const failedCompletion = await request(fixture.app)
      .post(`/api/v1/verifications/${verification1Id}/complete`)
      .send({
        result: "Failed",
        summary:
          "Secondary query path remains exploitable after remediation attempt 1.",
      })
      .expect(200);

    expect(failedCompletion.body.verification.status).toBe("Failed");
    expect(failedCompletion.body.finding.state).toBe("Verification failed");
    expect(failedCompletion.body.evidence).toEqual([]);
    expect(
      fixture.repositories.verifications
        .listChecks(organizationId, verification1Id)
        .map((check) => ({
          sequence: check.sequence,
          name: check.name,
          status: check.status,
        })),
    ).toEqual([
      { sequence: 1, name: expectedChecks[0], status: "Passed" },
      { sequence: 2, name: expectedChecks[1], status: "Failed" },
      { sequence: 3, name: expectedChecks[2], status: "Skipped" },
    ]);
    expect(auditActions("verification", verification1Id)).toEqual(
      expect.arrayContaining([
        "verification.started",
        "verification.check_recorded",
        "verification.failed",
      ]),
    );

    const evidenceAfterFailure = await request(fixture.app)
      .get("/api/v1/evidence")
      .query({ finding_id: findingId })
      .expect(200);
    expect(evidenceAfterFailure.body).toEqual([]);

    const remediation2 = await request(fixture.app)
      .post("/api/v1/remediations")
      .send(remediationBody(findingId, 2))
      .expect(201);
    const remediation2Id = remediation2.body.id as string;
    expect(remediation2Id).not.toBe(remediation1Id);

    await request(fixture.app)
      .post(`/api/v1/remediations/${remediation2Id}/complete`)
      .send({
        summary:
          "Secondary authorization path patched and regression coverage extended.",
        reference: "change://SEC-2099/remediation-2-complete",
      })
      .expect(200);
    expect(
      fixture.repositories.findings.getById(organizationId, findingId)?.state,
    ).toBe("Awaiting verification");

    const verification2 = await request(fixture.app)
      .post("/api/v1/verifications")
      .send(verificationBody(findingId, remediation2Id, 2))
      .expect(201);
    const verification2Id = verification2.body.verification.id as string;
    expect(verification2Id).not.toBe(verification1Id);

    for (const [index, name] of expectedChecks.entries()) {
      await request(fixture.app)
        .post(`/api/v1/verifications/${verification2Id}/checks`)
        .send({
          sequence: index + 1,
          name,
          status: "Passed",
          message: `Verification check ${index + 1} passed independently.`,
        })
        .expect(201);
    }

    const requestedEvidence = [
      {
        kind: "verification-result",
        label: "Secondary injection path retest",
        source_reference: `verification://${verification2Id}/secondary-query-path`,
        metadata: {
          outcome: "rejected",
          expected_status: 403,
          observed_status: 403,
        },
      },
      {
        kind: "regression-result",
        label: "Authorization regression suite",
        source_reference: `verification://${verification2Id}/regression-suite`,
        metadata: { passed: 18, failed: 0, skipped: 0 },
      },
    ];

    const passedCompletion = await request(fixture.app)
      .post(`/api/v1/verifications/${verification2Id}/complete`)
      .send({
        result: "Passed",
        summary:
          "All independent authorization checks and regression coverage passed.",
        evidence: requestedEvidence,
      })
      .expect(200);

    expect(passedCompletion.body.verification.status).toBe("Passed");
    expect(passedCompletion.body.finding.state).toBe("Verified fixed");
    expect(passedCompletion.body.evidence).toHaveLength(2);

    const findingDetail = await request(fixture.app)
      .get("/api/v1/findings/SEC-2099")
      .expect(200);
    expect(findingDetail.body.finding.state).toBe("Verified fixed");

    const firstRun = findingDetail.body.verifications.find(
      (item: { verification: { id: string } }) =>
        item.verification.id === verification1Id,
    );
    const secondRun = findingDetail.body.verifications.find(
      (item: { verification: { id: string } }) =>
        item.verification.id === verification2Id,
    );
    expect(firstRun?.verification.status).toBe("Failed");
    expect(secondRun?.verification.status).toBe("Passed");
    expect(
      firstRun?.checks.map((check: { sequence: number }) => check.sequence),
    ).toEqual([1, 2, 3]);
    expect(
      secondRun?.checks.map((check: { sequence: number }) => check.sequence),
    ).toEqual([1, 2, 3]);

    const evidenceList = await request(fixture.app)
      .get("/api/v1/evidence")
      .query({
        finding_id: findingId,
        verification_id: verification2Id,
        locked: true,
      })
      .expect(200);
    expect(evidenceList.headers["x-request-id"]).toMatch(requestIdPattern);
    expect(evidenceList.body).toHaveLength(2);

    for (const [index, evidence] of evidenceList.body.entries()) {
      expect(evidence.finding_id).toBe(findingId);
      expect(evidence.verification_id).toBe(verification2Id);
      expect(evidence.locked_at).toBe(now);
      expect(evidence.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(evidence.content_hash).toBe(
        hashEvidenceMetadata({
          kind: requestedEvidence[index].kind,
          label: requestedEvidence[index].label,
          sourceReference: requestedEvidence[index].source_reference,
          metadata: requestedEvidence[index].metadata,
        }),
      );

      const detail = await request(fixture.app)
        .get(`/api/v1/evidence/${evidence.id}`)
        .expect(200);
      expect(detail.body).toEqual(evidence);
      expect(auditActions("evidence", evidence.id)).toContain(
        "evidence.locked",
      );
    }

    expect(auditActions("remediation", remediation2Id)).toEqual(
      expect.arrayContaining(["remediation.started", "remediation.completed"]),
    );
    expect(auditActions("verification", verification2Id)).toEqual(
      expect.arrayContaining([
        "verification.started",
        "verification.check_recorded",
        "verification.passed",
      ]),
    );
  });

  it("rejects a second running verification through the persistent API", async () => {
    const imported = await request(fixture.app)
      .post("/api/v1/imports")
      .send(importBody())
      .expect(201);
    const findingId = imported.body.finding.id as string;

    const remediation = await request(fixture.app)
      .post("/api/v1/remediations")
      .send(remediationBody(findingId, 1))
      .expect(201);
    const remediationId = remediation.body.id as string;

    await request(fixture.app)
      .post(`/api/v1/remediations/${remediationId}/complete`)
      .send({
        summary: "Ready for one independent verification run.",
        reference: "change://SEC-2099/single-running-verification",
      })
      .expect(200);

    const first = await request(fixture.app)
      .post("/api/v1/verifications")
      .send(verificationBody(findingId, remediationId, 1))
      .expect(201);

    const second = await request(fixture.app)
      .post("/api/v1/verifications")
      .send(verificationBody(findingId, remediationId, 2))
      .expect(409);
    expect(second.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    );
    expect(second.body.code).toBe("VERIFICATION_ALREADY_RUNNING");

    const runs = fixture.repositories.verifications.listByFinding(
      organizationId,
      findingId,
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: first.body.verification.id,
      status: "Running",
    });
  });

  it("rejects malformed Task 12 service output through OpenAPI response validation", async () => {
    const malformed: Remediation = {
      id: "malformed-remediation",
      findingId: "malformed-finding",
      status: "In progress",
      summary: "Test-only malformed response",
      reference: "test://malformed-response",
      owner: undefined as unknown as string,
      startedAt: now,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    fixture.services.remediation.startRemediation = () => malformed;

    const response = await request(fixture.app)
      .post("/api/v1/remediations")
      .send(remediationBody("malformed-finding", 1))
      .expect(500);

    expect(response.headers["content-type"]).toMatch(
      /^application\/problem\+json/,
    );
    expect(response.body.code).toBe("INTERNAL_ERROR");
    expect(response.body).not.toHaveProperty("owner");
  });
});
