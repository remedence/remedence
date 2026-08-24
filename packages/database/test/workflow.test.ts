import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DashboardService } from "../../core/src/services/dashboard-service.js";
import { ImportFindingService } from "../../core/src/services/import-finding.js";
import { RemediationService } from "../../core/src/services/remediation-service.js";
import { ReportService } from "../../core/src/services/report-service.js";
import { VerificationService } from "../../core/src/services/verification-service.js";
import { hashEvidenceMetadata } from "../../evidence/src/index.js";
import type { RemedenceDatabase } from "../src/database.js";
import {
  getDatabaseConnection,
  openRemedenceDatabase,
} from "../src/database.js";
import { applyMigrations } from "../src/migrations.js";
import { createAuditEventRepository } from "../src/repositories/audit-event-repository.js";
import { createEvidenceRepository } from "../src/repositories/evidence-repository.js";
import { createFindingRepository } from "../src/repositories/finding-repository.js";
import { createRemediationRepository } from "../src/repositories/remediation-repository.js";
import { createReportRepository } from "../src/repositories/report-repository.js";
import { createVerificationRepository } from "../src/repositories/verification-repository.js";
import { seedHarborline } from "../src/seed.js";
import { createRepositorySet, createUnitOfWork } from "../src/unit-of-work.js";

const migrationsDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
const ORGANIZATION_ID = "org-harborline";
const REFERENCE_TIME = "2026-08-20T15:00:00.000Z";
const actor = { actorType: "operator", actorId: "local-user" };
const verifierActor = { actorType: "operator", actorId: "verification-user" };
const verificationProvenance = {
  sourceRevision: "commit-under-test",
  patchDigest: "a".repeat(64),
  verifier: {
    principalId: verifierActor.actorId,
    displayName: "Harborline verification operator",
    credentialType: "session" as const,
  },
};

let temporaryDirectory: string;
let database: RemedenceDatabase;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "remedence-workflow-"));
  database = openRemedenceDatabase({
    path: join(temporaryDirectory, "remedence.db"),
  });
  applyMigrations(database, migrationsDirectory);
  seedHarborline(database, { clock: { now: () => REFERENCE_TIME } });
});

afterEach(() => {
  database.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function sequenceIds(...values: string[]) {
  let index = 0;
  return {
    next(): string {
      const value = values[index];
      if (value === undefined) {
        throw new Error("The test ID sequence was exhausted.");
      }
      index += 1;
      return value;
    },
  };
}

function tickingClock(start = Date.parse("2026-08-20T15:00:00.000Z")) {
  let tick = 0;
  return {
    now(): string {
      const value = new Date(start + tick * 60_000).toISOString();
      tick += 1;
      return value;
    },
  };
}

function findingRepository() {
  return createFindingRepository(database, { referenceTime: REFERENCE_TIME });
}

function allAuditEvents() {
  const repository = createAuditEventRepository(database);
  const items = [];
  let cursor: string | undefined;
  do {
    const page = repository.list({
      organizationId: ORGANIZATION_ID,
      pageSize: 100,
      ...(cursor ? { cursor } : {}),
    });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

function createWorkflowServices(options: {
  remediationIds: string[];
  verificationIds: string[];
  clock?: ReturnType<typeof tickingClock>;
}) {
  const clock = options.clock ?? tickingClock();
  const unitOfWork = createUnitOfWork(database, {
    referenceTime: REFERENCE_TIME,
  });
  return {
    remediation: new RemediationService({
      unitOfWork,
      clock,
      idGenerator: sequenceIds(...options.remediationIds),
    }),
    verification: new VerificationService({
      unitOfWork,
      clock,
      idGenerator: sequenceIds(...options.verificationIds),
      hashEvidence: hashEvidenceMetadata,
    }),
  };
}

function completeSec1042Successfully(
  ids = {
    remediation: "remediation-sec-1042-2",
    verification: "verification-sec-1042-2",
    check1: "check-sec-1042-v2-primary",
    check2: "check-sec-1042-v2-secondary",
    evidence1: "evidence-sec-1042-v2-primary",
    evidence2: "evidence-sec-1042-v2-secondary",
  },
) {
  const finding = findingRepository().findByKey(ORGANIZATION_ID, "SEC-1042");
  if (!finding) throw new Error("SEC-1042 seed fixture is missing.");

  const services = createWorkflowServices({
    remediationIds: [ids.remediation],
    verificationIds: [
      ids.verification,
      ids.check1,
      ids.check2,
      ids.evidence1,
      ids.evidence2,
    ],
  });

  const remediation = services.remediation.startRemediation({
    organizationId: ORGANIZATION_ID,
    findingId: finding.id,
    owner: "L. Chen",
    summary: "Parameterize the remaining secondary query path",
    reference: "CHG-SEC-1042-2",
    actor,
  });
  expect(remediation.id).toBe(ids.remediation);
  expect(
    findingRepository().findByKey(ORGANIZATION_ID, "SEC-1042")?.state,
  ).toBe("Remediating");

  services.remediation.completeRemediation({
    organizationId: ORGANIZATION_ID,
    remediationId: remediation.id,
    summary: "Primary and secondary query paths are parameterized",
    reference: "CHG-SEC-1042-2",
    actor,
  });
  expect(
    findingRepository().findByKey(ORGANIZATION_ID, "SEC-1042")?.state,
  ).toBe("Awaiting verification");

  const verification = services.verification.startVerification({
    organizationId: ORGANIZATION_ID,
    findingId: finding.id,
    remediationId: remediation.id,
    method: "Independent manual retest",
    ...verificationProvenance,
    scope: "Patient Portal API primary and secondary query paths",
    checks: ["Primary query path", "Secondary query path"],
    actor: verifierActor,
  });
  expect(verification.id).toBe(ids.verification);

  for (const [sequence, name] of [
    [1, "Primary query path"],
    [2, "Secondary query path"],
  ] as const) {
    services.verification.recordVerificationCheck({
      organizationId: ORGANIZATION_ID,
      verificationId: verification.id,
      sequence,
      name,
      status: "Passed",
      message: "No SQL injection reproduced",
      actor: verifierActor,
    });
  }

  const completion = services.verification.completeVerification({
    organizationId: ORGANIZATION_ID,
    verificationId: verification.id,
    result: "Passed",
    summary: "Both query paths resist SQL injection",
    evidence: [
      {
        kind: "verification-result",
        label: "Primary query path retest",
        sourceReference: `verification://${verification.id}/primary`,
        metadata: { path: "primary", reproduced: false },
      },
      {
        kind: "verification-result",
        label: "Secondary query path retest",
        sourceReference: `verification://${verification.id}/secondary`,
        metadata: { path: "secondary", reproduced: false },
      },
    ],
    actor: verifierActor,
  });

  return { finding, remediation, verification, completion };
}

describe("persistent remediation and verification workflow", () => {
  it("persists a real imported finding, its import result, and its audit event", () => {
    const service = new ImportFindingService({
      unitOfWork: createUnitOfWork(database, { referenceTime: REFERENCE_TIME }),
      clock: tickingClock(),
      idGenerator: sequenceIds("finding-imported-9000", "import-record-9000"),
    });
    const input = {
      organizationId: ORGANIZATION_ID,
      companyId: "company-juniper-ridge-dental",
      findingKey: " sec-9000 ",
      title: "Imported authorization gap",
      description: "Authorization check missing on an administrative path",
      source: "Manual",
      severity: "High" as const,
      owner: "L. Chen",
      assetName: "Patient Portal API",
      detectedAt: "2026-08-20T14:00:00.000Z",
      slaDueAt: "2026-08-27T14:00:00.000Z",
      actor,
    };

    const result = service.importFinding(input);

    expect(result.importRecord).toMatchObject({
      id: "import-record-9000",
      findingId: "finding-imported-9000",
    });
    expect(
      findingRepository().findByKey(ORGANIZATION_ID, "SEC-9000"),
    ).toMatchObject({
      id: "finding-imported-9000",
      findingKey: "SEC-9000",
      state: "Needs remediation",
    });
    expect(
      allAuditEvents().some(
        (event) =>
          event.action === "finding.imported" &&
          event.entityId === "finding-imported-9000",
      ),
    ).toBe(true);

    let duplicate: unknown;
    try {
      service.importFinding({ ...input, findingKey: "SEC-9000" });
    } catch (error) {
      duplicate = error;
    }
    expect(duplicate).toMatchObject({ code: "DUPLICATE_FINDING", status: 409 });
  });

  it("takes seeded SEC-1042 from failed verification through remediation #2 to an atomic verified fix", () => {
    const initial = findingRepository().getDetail(ORGANIZATION_ID, "SEC-1042");
    expect(initial?.finding.state).toBe("Verification failed");
    expect(initial?.remediations.map((item) => item.status)).toEqual([
      "Completed",
    ]);
    expect(initial?.verifications.map((item) => item.status)).toEqual([
      "Failed",
    ]);
    expect(initial?.verifications[0]?.resultSummary).toBe(
      "Secondary query path remains vulnerable",
    );
    expect(
      initial?.verifications[0]?.checks.map((item) => item.status),
    ).toEqual(["Passed", "Failed"]);

    const { verification, completion } = completeSec1042Successfully();

    expect(completion.finding.state).toBe("Verified fixed");
    expect(completion.verification.status).toBe("Passed");
    expect(completion.evidence).toHaveLength(2);
    expect(
      completion.evidence.every(
        (item) =>
          item.verificationId === verification.id &&
          item.lockedAt !== null &&
          /^[0-9a-f]{64}$/.test(item.contentHash),
      ),
    ).toBe(true);

    const reread = findingRepository().getDetail(ORGANIZATION_ID, "SEC-1042");
    expect(reread?.finding.state).toBe("Verified fixed");
    expect(reread?.verifications.map((item) => item.status)).toEqual([
      "Failed",
      "Passed",
    ]);
    expect(reread?.verifications[0]).toMatchObject({
      id: "verification-sec-1042-1",
      status: "Failed",
      resultSummary: "Secondary query path remains vulnerable",
    });
    expect(reread?.verifications[0]?.checks[1]).toMatchObject({
      status: "Failed",
      message: "Secondary query path remains vulnerable",
    });
    expect(reread?.evidence).toHaveLength(2);
    expect(reread?.evidence.every((item) => item.lockedAt !== null)).toBe(true);
    expect(
      createRemediationRepository(database)
        .listByFinding(ORGANIZATION_ID, completion.finding.id)
        .map((item) => item.id),
    ).toEqual(["remediation-sec-1042-1", "remediation-sec-1042-2"]);
    expect(
      createVerificationRepository(database)
        .listByFinding(ORGANIZATION_ID, completion.finding.id)
        .map((item) => item.status),
    ).toEqual(["Failed", "Passed"]);

    const audit = allAuditEvents();
    const actions = audit.map((event) => event.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "remediation.started",
        "remediation.completed",
        "verification.started",
        "verification.check_recorded",
        "verification.passed",
        "evidence.locked",
      ]),
    );
  });

  it("persists a failed verification with its concrete reason and no locked evidence", () => {
    const target = findingRepository().findByKey(ORGANIZATION_ID, "SEC-1058");
    if (!target) throw new Error("SEC-1058 seed fixture is missing.");
    expect(target.state).toBe("Needs remediation");

    const services = createWorkflowServices({
      remediationIds: ["remediation-sec-1058-1"],
      verificationIds: ["verification-sec-1058-1", "check-sec-1058-1"],
    });
    const remediation = services.remediation.startRemediation({
      organizationId: ORGANIZATION_ID,
      findingId: target.id,
      owner: "M. Ortiz",
      summary: "Enable MFA on the remaining administrator account",
      reference: "CHG-SEC-1058-1",
      actor,
    });
    services.remediation.completeRemediation({
      organizationId: ORGANIZATION_ID,
      remediationId: remediation.id,
      summary: "MFA enrollment applied",
      reference: "CHG-SEC-1058-1",
      actor,
    });
    const verification = services.verification.startVerification({
      organizationId: ORGANIZATION_ID,
      findingId: target.id,
      remediationId: remediation.id,
      method: "Independent account policy review",
      ...verificationProvenance,
      scope: "Administrator MFA coverage",
      checks: ["All administrators require MFA"],
      actor: verifierActor,
    });
    services.verification.recordVerificationCheck({
      organizationId: ORGANIZATION_ID,
      verificationId: verification.id,
      sequence: 1,
      name: "All administrators require MFA",
      status: "Failed",
      message: "One administrator still lacks MFA enrollment",
      actor: verifierActor,
    });
    const completion = services.verification.completeVerification({
      organizationId: ORGANIZATION_ID,
      verificationId: verification.id,
      result: "Failed",
      summary: "One administrator still lacks MFA enrollment",
      evidence: [],
      actor: verifierActor,
    });

    expect(completion.finding.state).toBe("Verification failed");
    expect(completion.verification).toMatchObject({
      status: "Failed",
      resultSummary: "One administrator still lacks MFA enrollment",
    });
    expect(
      createEvidenceRepository(database).list({
        organizationId: ORGANIZATION_ID,
        verificationId: verification.id,
        pageSize: 100,
      }).items,
    ).toEqual([]);
    expect(
      allAuditEvents().some(
        (event) =>
          event.action === "verification.failed" &&
          event.entityId === verification.id,
      ),
    ).toBe(true);
  });

  it("rolls back the entire successful-verification transaction when the second evidence insert fails", () => {
    const initialFailure = findingRepository().getDetail(
      ORGANIZATION_ID,
      "SEC-1042",
    );
    expect(initialFailure?.verifications.map((item) => item.status)).toEqual([
      "Failed",
    ]);

    const finding = initialFailure?.finding;
    if (!finding) throw new Error("SEC-1042 seed fixture is missing.");
    const services = createWorkflowServices({
      remediationIds: ["remediation-rollback-2"],
      verificationIds: [
        "verification-rollback-2",
        "check-rollback-primary",
        "check-rollback-secondary",
        "evidence-rollback-1",
        "evidence-rollback-2",
      ],
    });
    const remediation = services.remediation.startRemediation({
      organizationId: ORGANIZATION_ID,
      findingId: finding.id,
      owner: "L. Chen",
      summary: "Patch both query paths",
      reference: "CHG-ROLLBACK-2",
      actor,
    });
    services.remediation.completeRemediation({
      organizationId: ORGANIZATION_ID,
      remediationId: remediation.id,
      summary: "Patch completed",
      reference: "CHG-ROLLBACK-2",
      actor,
    });
    const verification = services.verification.startVerification({
      organizationId: ORGANIZATION_ID,
      findingId: finding.id,
      remediationId: remediation.id,
      method: "Independent retest",
      ...verificationProvenance,
      scope: "Both query paths",
      checks: ["Primary query path", "Secondary query path"],
      actor: verifierActor,
    });
    for (const [sequence, name] of [
      [1, "Primary query path"],
      [2, "Secondary query path"],
    ] as const) {
      services.verification.recordVerificationCheck({
        organizationId: ORGANIZATION_ID,
        verificationId: verification.id,
        sequence,
        name,
        status: "Passed",
        message: "No SQL injection reproduced",
        actor: verifierActor,
      });
    }

    getDatabaseConnection(database).exec(`
      CREATE TRIGGER test_fail_second_evidence_insert
      BEFORE INSERT ON evidence_items
      WHEN NEW.id = 'evidence-rollback-2'
      BEGIN
        SELECT RAISE(ABORT, 'forced second evidence failure');
      END;
    `);

    expect(() =>
      services.verification.completeVerification({
        organizationId: ORGANIZATION_ID,
        verificationId: verification.id,
        result: "Passed",
        summary: "Both paths resist SQL injection",
        evidence: [
          {
            kind: "verification-result",
            label: "Primary result",
            sourceReference: "verification://rollback/primary",
            metadata: { path: "primary" },
          },
          {
            kind: "verification-result",
            label: "Secondary result",
            sourceReference: "verification://rollback/secondary",
            metadata: { path: "secondary" },
          },
        ],
        actor: verifierActor,
      }),
    ).toThrow(/forced second evidence failure/);

    expect(
      findingRepository().findByKey(ORGANIZATION_ID, "SEC-1042")?.state,
    ).toBe("Awaiting verification");
    expect(
      createVerificationRepository(database).getById(
        ORGANIZATION_ID,
        verification.id,
      )?.status,
    ).toBe("Running");
    expect(
      createEvidenceRepository(database).list({
        organizationId: ORGANIZATION_ID,
        verificationId: verification.id,
        pageSize: 100,
      }).items,
    ).toEqual([]);
    const actions = allAuditEvents()
      .filter((event) => event.entityId === verification.id)
      .map((event) => event.action);
    expect(actions).not.toContain("verification.passed");
    expect(actions).not.toContain("evidence.locked");
    expect(
      findingRepository().getDetail(ORGANIZATION_ID, "SEC-1042")
        ?.verifications[0],
    ).toMatchObject({
      id: "verification-sec-1042-1",
      status: "Failed",
      resultSummary: "Secondary query path remains vulnerable",
    });
  });

  it("keeps locked evidence immutable by exposing no update or delete repository operation", () => {
    const { completion } = completeSec1042Successfully();
    const repository = createEvidenceRepository(database) as unknown as Record<
      string,
      unknown
    >;

    expect(completion.evidence.every((item) => item.lockedAt !== null)).toBe(
      true,
    );
    const typedRepository = createEvidenceRepository(database);
    const firstEvidencePage = typedRepository.list({
      organizationId: ORGANIZATION_ID,
      findingId: completion.finding.id,
      locked: true,
      pageSize: 1,
    });
    const secondEvidencePage = typedRepository.list({
      organizationId: ORGANIZATION_ID,
      findingId: completion.finding.id,
      locked: true,
      pageSize: 1,
      cursor: firstEvidencePage.nextCursor!,
    });
    expect(firstEvidencePage.total).toBe(2);
    expect(firstEvidencePage.nextCursor).toEqual(expect.any(String));
    expect(secondEvidencePage.nextCursor).toBeNull();
    expect(secondEvidencePage.items[0]?.id).not.toBe(
      firstEvidencePage.items[0]?.id,
    );
    expect(
      typedRepository.list({
        organizationId: ORGANIZATION_ID,
        findingId: completion.finding.id,
        locked: true,
        pageSize: 100,
      }).items,
    ).toHaveLength(2);
    expect(
      typedRepository.list({
        organizationId: ORGANIZATION_ID,
        findingId: completion.finding.id,
        locked: false,
        pageSize: 100,
      }).items,
    ).toEqual([]);
    expect("update" in repository).toBe(false);
    expect("delete" in repository).toBe(false);
    expect("remove" in repository).toBe(false);
  });

  it("creates immutable report snapshots instead of rewriting report history", () => {
    const unitOfWork = createUnitOfWork(database, {
      referenceTime: REFERENCE_TIME,
    });
    const reportService = new ReportService({
      unitOfWork,
      clock: tickingClock(Date.parse("2026-08-20T16:00:00.000Z")),
      idGenerator: sequenceIds("report-before-fix", "report-after-fix"),
    });
    const companyId = "company-juniper-ridge-dental";

    const reportA = reportService.createReport({
      organizationId: ORGANIZATION_ID,
      companyId,
      periodLabel: "Before verification",
      actor,
    });
    const storedA = structuredClone(reportA);

    completeSec1042Successfully({
      remediation: "remediation-report-2",
      verification: "verification-report-2",
      check1: "check-report-primary",
      check2: "check-report-secondary",
      evidence1: "evidence-report-primary",
      evidence2: "evidence-report-secondary",
    });

    const reportB = reportService.createReport({
      organizationId: ORGANIZATION_ID,
      companyId,
      periodLabel: "After verification",
      actor,
    });
    const repository = createReportRepository(database);

    expect(repository.getById(ORGANIZATION_ID, reportA.id)).toEqual(storedA);
    expect(
      reportA.snapshot.findings.find((item) => item.findingKey === "SEC-1042")
        ?.state,
    ).toBe("Verification failed");
    expect(
      reportB.snapshot.findings.find((item) => item.findingKey === "SEC-1042")
        ?.state,
    ).toBe("Verified fixed");
    const reports = repository.listByCompany(ORGANIZATION_ID, companyId);
    expect(reports).toHaveLength(3);
    expect(reports.slice(0, 2).map((item) => item.id)).toEqual([
      "report-after-fix",
      "report-before-fix",
    ]);
    expect("update" in (repository as unknown as Record<string, unknown>)).toBe(
      false,
    );
    expect("delete" in (repository as unknown as Record<string, unknown>)).toBe(
      false,
    );
  });

  it("enforces organization isolation for evidence and report reads", () => {
    const { completion } = completeSec1042Successfully();
    const evidenceRepository = createEvidenceRepository(database);
    const reportRepository = createReportRepository(database);
    const reportService = new ReportService({
      unitOfWork: createUnitOfWork(database, { referenceTime: REFERENCE_TIME }),
      clock: tickingClock(),
      idGenerator: sequenceIds("report-isolation"),
    });
    const report = reportService.createReport({
      organizationId: ORGANIZATION_ID,
      companyId: "company-juniper-ridge-dental",
      periodLabel: "Isolation test",
      actor,
    });

    expect(
      evidenceRepository.getById("org-other", completion.evidence[0]!.id),
    ).toBeUndefined();
    expect(
      evidenceRepository.list({
        organizationId: "org-other",
        findingId: completion.finding.id,
        pageSize: 100,
      }).items,
    ).toEqual([]);
    expect(reportRepository.getById("org-other", report.id)).toBeUndefined();
    expect(
      reportRepository.listByCompany("org-other", report.companyId),
    ).toEqual([]);
  });

  it("maps a database duplicate verification-check sequence to a conflict", () => {
    const repository = createVerificationRepository(database);
    let caught: unknown;
    try {
      repository.insertCheck({
        organizationId: ORGANIZATION_ID,
        id: "check-duplicate-sequence",
        verificationId: "verification-sec-1042-1",
        sequence: 1,
        name: "Duplicate sequence",
        status: "Pending",
        message: "",
        createdAt: REFERENCE_TIME,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "DUPLICATE_VERIFICATION_CHECK",
      status: 409,
    });
  });

  it("surfaces representative zero-row mutations as CONCURRENT_STATE_CHANGE conflicts", () => {
    const findings = findingRepository();
    const remediations = createRemediationRepository(database);
    const verifications = createVerificationRepository(database);
    const sec1042 = findings.findByKey(ORGANIZATION_ID, "SEC-1042");
    if (!sec1042) throw new Error("SEC-1042 seed fixture is missing.");

    for (const operation of [
      () =>
        findings.updateState(
          ORGANIZATION_ID,
          sec1042.id,
          "Needs remediation",
          "Remediating",
          REFERENCE_TIME,
        ),
      () =>
        remediations.complete(
          ORGANIZATION_ID,
          "remediation-sec-1042-1",
          "Already complete",
          "CHG-SEC-1042-1",
          "local-user",
          REFERENCE_TIME,
          REFERENCE_TIME,
        ),
      () =>
        verifications.complete(
          ORGANIZATION_ID,
          "verification-sec-1042-1",
          "Passed",
          "Already complete",
          REFERENCE_TIME,
        ),
    ]) {
      let caught: unknown;
      try {
        operation();
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        code: "CONCURRENT_STATE_CHANGE",
        status: 409,
      });
    }
  });

  it("derives the seeded dashboard foundation from repository data and Task 9 priority ordering", () => {
    const repositories = createRepositorySet(database, {
      referenceTime: REFERENCE_TIME,
    });
    const dashboard = new DashboardService({ repositories }).getDashboard({
      organizationId: ORGANIZATION_ID,
      sort: "priority",
      includeVerified: false,
      pageSize: 25,
    });

    expect(dashboard.metrics).toEqual({
      managedCompanies: 12,
      openFindings: 47,
      awaitingVerification: 8,
      verificationFailed: 3,
      verifiedFixed: 126,
      slaBreaches: 4,
    });
    expect(dashboard.actionQueue[0]?.findingKey).toBe("SEC-1042");
  });
});
