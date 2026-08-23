import { describe, expect, it } from "vitest";
import {
  DomainError,
  findingPriorityBucket,
  type AuditEvent,
  type Company,
  type DashboardFinding,
  type EvidenceItem,
  type Finding,
  type FindingQuery,
  type Page,
  type Remediation,
  type Report,
  type RepositorySet,
  type UnitOfWork,
  type VerificationCheck,
  type VerificationRun,
} from "../src/index.js";
import { DashboardService } from "../src/services/dashboard-service.js";
import { ImportFindingService } from "../src/services/import-finding.js";
import { RemediationService } from "../src/services/remediation-service.js";
import { ReportService } from "../src/services/report-service.js";
import { VerificationService } from "../src/services/verification-service.js";

const NOW = "2026-08-20T12:00:00.000Z";
const ORG = "org-harborline";
const COMPANY_ID = "company-juniper";

const company: Company = {
  id: COMPANY_ID,
  organizationId: ORG,
  name: "Juniper Ridge Dental",
  riskScore: 82,
  riskLevel: "High",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function finding(
  id: string,
  findingKey: string,
  state: Finding["state"] = "Needs remediation",
  overrides: Partial<Finding> = {},
): Finding {
  return {
    id,
    organizationId: ORG,
    companyId: COMPANY_ID,
    findingKey,
    title: `${findingKey} title`,
    description: `${findingKey} description`,
    source: "Manual",
    severity: "High",
    state,
    owner: "L. Chen",
    assetName: "Patient Portal API",
    detectedAt: "2026-08-10T08:00:00.000Z",
    slaDueAt: "2026-08-25T00:00:00.000Z",
    createdAt: "2026-08-10T08:00:00.000Z",
    updatedAt: "2026-08-10T08:00:00.000Z",
    ...overrides,
  };
}

interface Harness {
  repositories: RepositorySet & {
    findings: RepositorySet["findings"] & {
      getById(organizationId: string, findingId: string): Finding | undefined;
    };
    verifications: RepositorySet["verifications"] & {
      recordCheck(
        verificationId: string,
        sequence: number,
        name: string,
        status: Exclude<VerificationCheck["status"], "Pending">,
        message: string,
      ): void;
    };
  };
  unitOfWork: UnitOfWork;
  state: {
    companies: Company[];
    findings: Finding[];
    remediations: Remediation[];
    verifications: VerificationRun[];
    checks: VerificationCheck[];
    evidence: EvidenceItem[];
    reports: Report[];
    auditEvents: AuditEvent[];
  };
}

function createHarness(initialFindings: Finding[] = []): Harness {
  const state = {
    companies: [{ ...company }],
    findings: initialFindings.map((item) => ({ ...item })),
    remediations: [] as Remediation[],
    verifications: [] as VerificationRun[],
    checks: [] as VerificationCheck[],
    evidence: [] as EvidenceItem[],
    reports: [] as Report[],
    auditEvents: [] as AuditEvent[],
  };

  function dashboardRows(query: FindingQuery): DashboardFinding[] {
    const reference = Date.parse(NOW);
    let rows = state.findings.filter(
      (item) => item.organizationId === query.organizationId,
    );
    if (!query.includeVerified) {
      rows = rows.filter((item) => item.state !== "Verified fixed");
    }
    if (query.search !== undefined && query.search !== "") {
      const search = query.search.toLocaleLowerCase("en-US");
      rows = rows.filter((item) => {
        const companyName = state.companies.find(
          (candidate) => candidate.id === item.companyId,
        )?.name;
        return [
          item.findingKey,
          item.title,
          companyName ?? "",
          item.source,
          item.owner,
          item.assetName,
        ].some((value) => value.toLocaleLowerCase("en-US").includes(search));
      });
    }
    if (query.companyId !== undefined) {
      rows = rows.filter((item) => item.companyId === query.companyId);
    }
    if (query.state !== undefined) {
      rows = rows.filter((item) => item.state === query.state);
    }
    if (query.severity !== undefined) {
      rows = rows.filter((item) => item.severity === query.severity);
    }
    if (query.owner !== undefined) {
      rows = rows.filter((item) => item.owner === query.owner);
    }

    const mapped = rows.map((item): DashboardFinding => {
      const slaBreached =
        item.state !== "Verified fixed" &&
        Date.parse(item.slaDueAt) < reference;
      return {
        ...item,
        companyName:
          state.companies.find((candidate) => candidate.id === item.companyId)
            ?.name ?? "Unknown company",
        slaBreached,
        priorityBucket: findingPriorityBucket({ ...item, slaBreached }),
      };
    });

    mapped.sort((left, right) => {
      if (query.sort === "newest") {
        return (
          right.detectedAt.localeCompare(left.detectedAt) ||
          left.findingKey.localeCompare(right.findingKey)
        );
      }
      if (query.sort === "sla") {
        return (
          Number(right.slaBreached) - Number(left.slaBreached) ||
          left.slaDueAt.localeCompare(right.slaDueAt) ||
          left.findingKey.localeCompare(right.findingKey)
        );
      }
      return (
        left.priorityBucket - right.priorityBucket ||
        left.slaDueAt.localeCompare(right.slaDueAt) ||
        left.detectedAt.localeCompare(right.detectedAt) ||
        left.findingKey.localeCompare(right.findingKey)
      );
    });
    return mapped;
  }

  const repositories = {
    companies: {
      getById(organizationId: string, companyId: string) {
        return state.companies.find(
          (item) =>
            item.organizationId === organizationId && item.id === companyId,
        );
      },
      list(organizationId: string) {
        return state.companies.filter(
          (item) => item.organizationId === organizationId,
        );
      },
      insert(value: Company) {
        state.companies.push({ ...value });
      },
    },
    findings: {
      getById(organizationId: string, findingId: string) {
        return state.findings.find(
          (item) =>
            item.organizationId === organizationId && item.id === findingId,
        );
      },
      findByKey(organizationId: string, findingKey: string) {
        const normalized = findingKey.trim().toLocaleUpperCase("en-US");
        return state.findings.find(
          (item) =>
            item.organizationId === organizationId &&
            item.findingKey.trim().toLocaleUpperCase("en-US") === normalized,
        );
      },
      list(query: FindingQuery): Page<DashboardFinding> {
        const rows = dashboardRows(query);
        const start = (query.page - 1) * query.pageSize;
        return {
          items: rows.slice(start, start + query.pageSize),
          page: query.page,
          pageSize: query.pageSize,
          total: rows.length,
        };
      },
      getDetail(organizationId: string, findingKey: string) {
        const found = this.findByKey(organizationId, findingKey);
        if (!found) return undefined;
        const foundCompany = state.companies.find(
          (item) =>
            item.id === found.companyId &&
            item.organizationId === organizationId,
        );
        if (!foundCompany) return undefined;
        const remediations = state.remediations.filter(
          (item) => item.findingId === found.id,
        );
        const verifications = state.verifications
          .filter((item) => item.findingId === found.id)
          .map((run) => ({
            ...run,
            checks: state.checks.filter(
              (check) => check.verificationId === run.id,
            ),
          }));
        return {
          finding: found,
          company: foundCompany,
          remediations,
          verifications,
          evidence: state.evidence.filter(
            (item) => item.findingId === found.id,
          ),
          auditEvents: state.auditEvents.filter(
            (event) => event.organizationId === organizationId,
          ),
        };
      },
      insert(value: Finding) {
        state.findings.push({ ...value });
      },
      updateState(
        id: string,
        expectedState: Finding["state"],
        nextState: Finding["state"],
        updatedAt: string,
      ) {
        const index = state.findings.findIndex((item) => item.id === id);
        if (index < 0 || state.findings[index]?.state !== expectedState) {
          throw new DomainError(
            "CONCURRENT_STATE_CHANGE",
            409,
            "Finding state changed concurrently.",
          );
        }
        state.findings[index] = {
          ...state.findings[index]!,
          state: nextState,
          updatedAt,
        };
      },
    },
    remediations: {
      getById(id: string) {
        return state.remediations.find((item) => item.id === id);
      },
      listByFinding(findingId: string) {
        return state.remediations.filter(
          (item) => item.findingId === findingId,
        );
      },
      insert(value: Remediation) {
        state.remediations.push({ ...value });
      },
      complete(
        id: string,
        summary: string,
        reference: string,
        completedAt: string,
        updatedAt: string,
      ) {
        const index = state.remediations.findIndex((item) => item.id === id);
        if (index < 0 || state.remediations[index]?.status !== "In progress") {
          throw new DomainError(
            "CONCURRENT_STATE_CHANGE",
            409,
            "Remediation state changed concurrently.",
          );
        }
        state.remediations[index] = {
          ...state.remediations[index]!,
          status: "Completed",
          summary,
          reference,
          completedAt,
          updatedAt,
        };
      },
    },
    verifications: {
      getById(id: string) {
        return state.verifications.find((item) => item.id === id);
      },
      listByFinding(findingId: string) {
        return state.verifications.filter(
          (item) => item.findingId === findingId,
        );
      },
      insert(value: VerificationRun) {
        state.verifications.push({ ...value });
      },
      insertCheck(value: VerificationCheck) {
        if (
          state.checks.some(
            (item) =>
              item.verificationId === value.verificationId &&
              item.sequence === value.sequence,
          )
        ) {
          throw new DomainError(
            "DUPLICATE_VERIFICATION_CHECK",
            409,
            "Verification check sequence already exists.",
          );
        }
        state.checks.push({ ...value });
      },
      recordCheck(
        verificationId: string,
        sequence: number,
        name: string,
        status: Exclude<VerificationCheck["status"], "Pending">,
        message: string,
      ) {
        const index = state.checks.findIndex(
          (item) =>
            item.verificationId === verificationId &&
            item.sequence === sequence,
        );
        if (
          index < 0 ||
          state.checks[index]?.status !== "Pending" ||
          state.checks[index]?.name !== name
        ) {
          throw new DomainError(
            "CONCURRENT_STATE_CHANGE",
            409,
            "Verification check cannot be recorded.",
          );
        }
        state.checks[index] = {
          ...state.checks[index]!,
          status,
          message,
        };
      },
      listChecks(verificationId: string) {
        return state.checks
          .filter((item) => item.verificationId === verificationId)
          .sort(
            (left, right) =>
              left.sequence - right.sequence || left.id.localeCompare(right.id),
          );
      },
      complete(
        id: string,
        status: "Passed" | "Failed",
        summary: string,
        completedAt: string,
      ) {
        const index = state.verifications.findIndex((item) => item.id === id);
        if (index < 0 || state.verifications[index]?.status !== "Running") {
          throw new DomainError(
            "CONCURRENT_STATE_CHANGE",
            409,
            "Verification state changed concurrently.",
          );
        }
        state.verifications[index] = {
          ...state.verifications[index]!,
          status,
          resultSummary: summary,
          completedAt,
        };
      },
    },
    evidence: {
      getById(organizationId: string, evidenceId: string) {
        const item = state.evidence.find(
          (candidate) => candidate.id === evidenceId,
        );
        const relatedFinding = item
          ? state.findings.find((candidate) => candidate.id === item.findingId)
          : undefined;
        return relatedFinding?.organizationId === organizationId
          ? item
          : undefined;
      },
      list(query: {
        organizationId: string;
        findingId?: string;
        verificationId?: string;
        locked?: boolean;
      }) {
        return state.evidence.filter((item) => {
          const relatedFinding = state.findings.find(
            (candidate) => candidate.id === item.findingId,
          );
          return (
            relatedFinding?.organizationId === query.organizationId &&
            (query.findingId === undefined ||
              item.findingId === query.findingId) &&
            (query.verificationId === undefined ||
              item.verificationId === query.verificationId) &&
            (query.locked === undefined ||
              (item.lockedAt !== null) === query.locked)
          );
        });
      },
      insert(value: EvidenceItem) {
        state.evidence.push({
          ...value,
          metadata: structuredClone(value.metadata),
        });
      },
    },
    reports: {
      getById(organizationId: string, reportId: string) {
        const item = state.reports.find(
          (candidate) => candidate.id === reportId,
        );
        const relatedCompany = item
          ? state.companies.find((candidate) => candidate.id === item.companyId)
          : undefined;
        return relatedCompany?.organizationId === organizationId
          ? item
          : undefined;
      },
      listByCompany(organizationId: string, companyId: string) {
        const owned = state.companies.some(
          (item) =>
            item.organizationId === organizationId && item.id === companyId,
        );
        if (!owned) return [];
        return state.reports
          .filter((item) => item.companyId === companyId)
          .sort(
            (left, right) =>
              right.generatedAt.localeCompare(left.generatedAt) ||
              right.id.localeCompare(left.id),
          );
      },
      insert(value: Report) {
        state.reports.push(structuredClone(value));
      },
    },
    auditEvents: {
      append(value: AuditEvent) {
        state.auditEvents.push(structuredClone(value));
      },
      list(query: {
        organizationId: string;
        entityType?: string;
        entityId?: string;
        from?: string;
        to?: string;
        page: number;
        pageSize: number;
      }): Page<AuditEvent> {
        let rows = state.auditEvents.filter(
          (item) => item.organizationId === query.organizationId,
        );
        if (query.entityType !== undefined) {
          rows = rows.filter((item) => item.entityType === query.entityType);
        }
        if (query.entityId !== undefined) {
          rows = rows.filter((item) => item.entityId === query.entityId);
        }
        return {
          items: rows,
          page: query.page,
          pageSize: query.pageSize,
          total: rows.length,
        };
      },
    },
  } as unknown as Harness["repositories"];

  const unitOfWork: UnitOfWork = {
    run<T>(operation: (repositories: RepositorySet) => T): T {
      return operation(repositories);
    },
  };

  return { repositories, unitOfWork, state };
}

function ids(...values: string[]) {
  let index = 0;
  return {
    next() {
      const value = values[index];
      if (value === undefined) throw new Error("No test ID remains.");
      index += 1;
      return value;
    },
  };
}

const clock = { now: () => NOW };
const actor = { actorType: "operator", actorId: "local-user" };
const hashEvidence = () => "a".repeat(64);

function expectDomainError(
  operation: () => unknown,
  code: string,
  status = 409,
): void {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DomainError);
  expect((caught as DomainError).code).toBe(code);
  expect((caught as DomainError).status).toBe(status);
}

describe("ImportFindingService", () => {
  it("rejects a case-insensitive duplicate with DUPLICATE_FINDING 409", () => {
    const harness = createHarness([finding("finding-1042", "SEC-1042")]);
    const service = new ImportFindingService({
      unitOfWork: harness.unitOfWork,
      clock,
      idGenerator: ids("finding-new", "import-new"),
    });

    expectDomainError(
      () =>
        service.importFinding({
          organizationId: ORG,
          companyId: COMPANY_ID,
          findingKey: " sec-1042 ",
          title: "Duplicate",
          description: "Duplicate",
          source: "Manual",
          severity: "High",
          owner: "L. Chen",
          assetName: "Patient Portal API",
          detectedAt: NOW,
          slaDueAt: "2026-08-30T00:00:00.000Z",
          actor,
        }),
      "DUPLICATE_FINDING",
    );
  });

  it("rejects an import that attempts to begin Verified fixed", () => {
    const harness = createHarness();
    const service = new ImportFindingService({
      unitOfWork: harness.unitOfWork,
      clock,
      idGenerator: ids("finding-new", "import-new"),
    });

    expectDomainError(
      () =>
        service.importFinding({
          organizationId: ORG,
          companyId: COMPANY_ID,
          findingKey: "SEC-2000",
          title: "Invalid initial state",
          description: "Invalid",
          source: "Manual",
          severity: "High",
          state: "Verified fixed",
          owner: "L. Chen",
          assetName: "Patient Portal API",
          detectedAt: NOW,
          slaDueAt: "2026-08-30T00:00:00.000Z",
          actor,
        }),
      "INVALID_INITIAL_FINDING_STATE",
    );
  });

  it("normalizes imported timestamps with offsets to canonical UTC", () => {
    const harness = createHarness();
    const service = new ImportFindingService({
      unitOfWork: harness.unitOfWork,
      clock,
      idGenerator: ids("finding-new", "import-new"),
    });

    const result = service.importFinding({
      organizationId: ORG,
      companyId: COMPANY_ID,
      findingKey: "SEC-UTC-1",
      title: "Offset timestamps",
      description: "Normalize imported timestamps before persistence.",
      source: "Manual",
      severity: "High",
      owner: "L. Chen",
      assetName: "Patient Portal API",
      detectedAt: "2026-08-20T23:30:00-02:00",
      slaDueAt: "2026-08-22T01:00:00+14:00",
      actor,
    });

    expect(result.finding.detectedAt).toBe("2026-08-21T01:30:00.000Z");
    expect(result.finding.slaDueAt).toBe("2026-08-21T11:00:00.000Z");
    expect(harness.state.findings[0]).toMatchObject({
      detectedAt: "2026-08-21T01:30:00.000Z",
      slaDueAt: "2026-08-21T11:00:00.000Z",
    });
  });
  it("normalizes the key, begins Needs remediation, and appends an audit event", () => {
    const harness = createHarness();
    const service = new ImportFindingService({
      unitOfWork: harness.unitOfWork,
      clock,
      idGenerator: ids("finding-new", "import-new"),
    });

    const result = service.importFinding({
      organizationId: ORG,
      companyId: COMPANY_ID,
      findingKey: " sec-2001 ",
      title: "Imported finding",
      description: "Imported",
      source: "Manual",
      severity: "High",
      owner: "L. Chen",
      assetName: "Patient Portal API",
      detectedAt: NOW,
      slaDueAt: "2026-08-30T00:00:00.000Z",
      actor,
    });

    expect(result.finding).toMatchObject({
      id: "finding-new",
      findingKey: "SEC-2001",
      state: "Needs remediation",
    });
    expect(result.importRecord).toMatchObject({
      id: "import-new",
      source: "Manual",
      findingId: "finding-new",
    });
    expect(harness.state.auditEvents.map((event) => event.action)).toEqual([
      "finding.imported",
    ]);
  });
});

describe("RemediationService", () => {
  it.each(["Needs remediation", "Verification failed"] as const)(
    "starts remediation from %s",
    (state) => {
      const base = finding("finding-1042", "SEC-1042", state);
      const harness = createHarness([base]);
      const service = new RemediationService({
        unitOfWork: harness.unitOfWork,
        clock,
        idGenerator: ids("remediation-2"),
      });

      const remediation = service.startRemediation({
        organizationId: ORG,
        findingId: base.id,
        owner: "L. Chen",
        summary: "Patch the remaining query path",
        reference: "CHG-1042-2",
        actor,
      });

      expect(remediation.status).toBe("In progress");
      expect(harness.state.findings[0]?.state).toBe("Remediating");
      expect(harness.state.auditEvents.at(-1)?.action).toBe(
        "remediation.started",
      );
    },
  );

  it.each(["Awaiting verification", "Verified fixed"] as const)(
    "rejects starting remediation from %s",
    (state) => {
      const base = finding("finding-1042", "SEC-1042", state);
      const harness = createHarness([base]);
      const service = new RemediationService({
        unitOfWork: harness.unitOfWork,
        clock,
        idGenerator: ids("remediation-2"),
      });

      expectDomainError(
        () =>
          service.startRemediation({
            organizationId: ORG,
            findingId: base.id,
            owner: "L. Chen",
            summary: "Should not start",
            reference: "CHG-INVALID",
            actor,
          }),
        "INVALID_FINDING_TRANSITION",
      );
    },
  );

  it("completes an in-progress remediation and moves the finding to Awaiting verification", () => {
    const base = finding("finding-1042", "SEC-1042", "Remediating");
    const harness = createHarness([base]);
    harness.state.remediations.push({
      id: "remediation-2",
      findingId: base.id,
      status: "In progress",
      summary: "Patch remaining path",
      reference: "CHG-1042-2",
      owner: "L. Chen",
      startedAt: "2026-08-20T11:00:00.000Z",
      completedAt: null,
      createdAt: "2026-08-20T11:00:00.000Z",
      updatedAt: "2026-08-20T11:00:00.000Z",
    });
    const service = new RemediationService({
      unitOfWork: harness.unitOfWork,
      clock,
      idGenerator: ids("unused"),
    });

    const completed = service.completeRemediation({
      organizationId: ORG,
      remediationId: "remediation-2",
      summary: "Both query paths parameterized",
      reference: "CHG-1042-2",
      actor,
    });

    expect(completed).toMatchObject({ status: "Completed", completedAt: NOW });
    expect(harness.state.findings[0]?.state).toBe("Awaiting verification");
    expect(harness.state.auditEvents.at(-1)?.action).toBe(
      "remediation.completed",
    );
  });
});

describe("VerificationService", () => {
  function eligibleHarness() {
    const base = finding("finding-1042", "SEC-1042", "Awaiting verification");
    const harness = createHarness([base]);
    harness.state.remediations.push({
      id: "remediation-2",
      findingId: base.id,
      status: "Completed",
      summary: "Both query paths parameterized",
      reference: "CHG-1042-2",
      owner: "L. Chen",
      startedAt: "2026-08-20T10:00:00.000Z",
      completedAt: "2026-08-20T11:00:00.000Z",
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-20T11:00:00.000Z",
    });
    return { base, harness };
  }

  it("requires Awaiting verification and at least one completed remediation", () => {
    const base = finding("finding-1042", "SEC-1042", "Awaiting verification");
    const harness = createHarness([base]);
    const service = new VerificationService({
      unitOfWork: harness.unitOfWork,
      clock,
      idGenerator: ids("verification-2", "check-a"),
      hashEvidence,
    });

    expectDomainError(
      () =>
        service.startVerification({
          organizationId: ORG,
          findingId: base.id,
          remediationId: "missing-remediation",
          method: "Independent manual retest",
          workerName: "Operator",
          scope: "Patient Portal API",
          checks: ["Primary query path"],
          actor,
        }),
      "COMPLETED_REMEDIATION_REQUIRED",
    );
  });

  it("creates a Running verification with unique pending required checks", () => {
    const { base, harness } = eligibleHarness();
    const service = new VerificationService({
      unitOfWork: harness.unitOfWork,
      clock,
      idGenerator: ids("verification-2", "check-1", "check-2"),
      hashEvidence,
    });

    const run = service.startVerification({
      organizationId: ORG,
      findingId: base.id,
      remediationId: "remediation-2",
      method: "Independent manual retest",
      workerName: "Operator",
      scope: "Patient Portal API",
      checks: ["Primary query path", "Secondary query path"],
      actor,
    });

    expect(run.status).toBe("Running");
    expect(
      harness.state.checks.map((check) => [check.sequence, check.status]),
    ).toEqual([
      [1, "Pending"],
      [2, "Pending"],
    ]);
    expect(harness.state.auditEvents.at(-1)?.action).toBe(
      "verification.started",
    );
  });

  it("rejects the persisted remediation owner as the asserted verifier", () => {
    const { base, harness } = eligibleHarness();
    const service = new VerificationService({
      unitOfWork: harness.unitOfWork,
      clock,
      idGenerator: ids("unused-verification"),
      hashEvidence,
    });

    expectDomainError(
      () =>
        service.startVerification({
          organizationId: ORG,
          findingId: base.id,
          remediationId: "remediation-2",
          method: "Independent manual retest",
          workerName: "  l. CHEN  ",
          scope: "Patient Portal API",
          checks: ["Primary query path"],
          actor,
        }),
      "VERIFIER_NOT_INDEPENDENT",
    );
    expect(harness.state.verifications).toHaveLength(0);
    expect(harness.state.checks).toHaveLength(0);
  });

  it("rejects a second running verification for the same finding", () => {
    const { base, harness } = eligibleHarness();
    const service = new VerificationService({
      unitOfWork: harness.unitOfWork,
      clock,
      idGenerator: ids(
        "verification-2",
        "check-1",
        "verification-3",
        "check-2",
      ),
      hashEvidence,
    });

    service.startVerification({
      organizationId: ORG,
      findingId: base.id,
      remediationId: "remediation-2",
      method: "Independent manual retest",
      workerName: "Operator",
      scope: "Patient Portal API",
      checks: ["Primary query path"],
      actor,
    });

    expectDomainError(
      () =>
        service.startVerification({
          organizationId: ORG,
          findingId: base.id,
          remediationId: "remediation-2",
          method: "Second independent retest",
          workerName: "Another operator",
          scope: "Patient Portal API",
          checks: ["Secondary query path"],
          actor,
        }),
      "VERIFICATION_ALREADY_RUNNING",
    );
    expect(harness.state.verifications).toHaveLength(1);
  });

  it("rejects duplicate expected check names before creating the run", () => {
    const { base, harness } = eligibleHarness();
    const service = new VerificationService({
      unitOfWork: harness.unitOfWork,
      clock,
      idGenerator: ids("verification-2", "check-1", "check-2"),
      hashEvidence,
    });

    expectDomainError(
      () =>
        service.startVerification({
          organizationId: ORG,
          findingId: base.id,
          remediationId: "remediation-2",
          method: "Independent manual retest",
          workerName: "Operator",
          scope: "Patient Portal API",
          checks: ["Primary query path", "Primary query path"],
          actor,
        }),
      "DUPLICATE_VERIFICATION_CHECK",
    );
  });

  it("records one required check exactly once", () => {
    const { base, harness } = eligibleHarness();
    const service = new VerificationService({
      unitOfWork: harness.unitOfWork,
      clock,
      idGenerator: ids("verification-2", "check-1"),
      hashEvidence,
    });
    service.startVerification({
      organizationId: ORG,
      findingId: base.id,
      remediationId: "remediation-2",
      method: "Independent manual retest",
      workerName: "Operator",
      scope: "Patient Portal API",
      checks: ["Primary query path"],
      actor,
    });

    const recorded = service.recordVerificationCheck({
      organizationId: ORG,
      verificationId: "verification-2",
      sequence: 1,
      name: "Primary query path",
      status: "Passed",
      message: "No injection reproduced",
      actor,
    });
    expect(recorded.status).toBe("Passed");
    expectDomainError(
      () =>
        service.recordVerificationCheck({
          organizationId: ORG,
          verificationId: "verification-2",
          sequence: 1,
          name: "Primary query path",
          status: "Passed",
          message: "Duplicate result",
          actor,
        }),
      "CONCURRENT_STATE_CHANGE",
    );
  });

  it("requires a concrete failed check and nonblank summary to complete Failed", () => {
    const { base, harness } = eligibleHarness();
    const service = new VerificationService({
      unitOfWork: harness.unitOfWork,
      clock,
      idGenerator: ids("verification-2", "check-1"),
      hashEvidence,
    });
    service.startVerification({
      organizationId: ORG,
      findingId: base.id,
      remediationId: "remediation-2",
      method: "Independent manual retest",
      workerName: "Operator",
      scope: "Patient Portal API",
      checks: ["Secondary query path"],
      actor,
    });
    service.recordVerificationCheck({
      organizationId: ORG,
      verificationId: "verification-2",
      sequence: 1,
      name: "Secondary query path",
      status: "Failed",
      message: "Secondary path remains vulnerable",
      actor,
    });

    expectDomainError(
      () =>
        service.completeVerification({
          organizationId: ORG,
          verificationId: "verification-2",
          result: "Failed",
          summary: "   ",
          evidence: [],
          actor,
        }),
      "VERIFICATION_FAILURE_SUMMARY_REQUIRED",
    );

    const completion = service.completeVerification({
      organizationId: ORG,
      verificationId: "verification-2",
      result: "Failed",
      summary: "Secondary query path remains vulnerable",
      evidence: [],
      actor,
    });
    expect(completion.verification.status).toBe("Failed");
    expect(completion.finding.state).toBe("Verification failed");
    expect(completion.evidence).toEqual([]);
    expect(harness.state.auditEvents.at(-1)?.action).toBe(
      "verification.failed",
    );
  });

  it.each(["Pending", "Failed"] as const)(
    "rejects Passed completion while a required check is %s",
    (status) => {
      const { base, harness } = eligibleHarness();
      const service = new VerificationService({
        unitOfWork: harness.unitOfWork,
        clock,
        idGenerator: ids("verification-2", "check-1", "evidence-1"),
        hashEvidence,
      });
      service.startVerification({
        organizationId: ORG,
        findingId: base.id,
        remediationId: "remediation-2",
        method: "Independent manual retest",
        workerName: "Operator",
        scope: "Patient Portal API",
        checks: ["Required check"],
        actor,
      });
      if (status === "Failed") {
        service.recordVerificationCheck({
          organizationId: ORG,
          verificationId: "verification-2",
          sequence: 1,
          name: "Required check",
          status: "Failed",
          message: "Still vulnerable",
          actor,
        });
      }

      expectDomainError(
        () =>
          service.completeVerification({
            organizationId: ORG,
            verificationId: "verification-2",
            result: "Passed",
            summary: "Should not pass",
            evidence: [
              {
                kind: "verification-result",
                label: "Retest",
                sourceReference: "verification://verification-2",
                metadata: { result: "Passed" },
              },
            ],
            actor,
          }),
        "VERIFICATION_CHECKS_INCOMPLETE",
      );
    },
  );

  it("passes only after every required check passes, creates locked evidence, and preserves earlier failure history", () => {
    const { base, harness } = eligibleHarness();
    harness.state.verifications.push({
      id: "verification-1",
      findingId: base.id,
      remediationId: "remediation-1",
      status: "Failed",
      method: "Independent manual retest",
      workerName: "Operator",
      scope: "Patient Portal API",
      resultSummary: "Secondary query path remains vulnerable",
      startedAt: "2026-08-12T00:00:00.000Z",
      completedAt: "2026-08-12T00:10:00.000Z",
      createdAt: "2026-08-12T00:00:00.000Z",
    });
    harness.state.checks.push({
      id: "check-old",
      verificationId: "verification-1",
      sequence: 1,
      name: "Secondary query path",
      status: "Failed",
      message: "Secondary query path remains vulnerable",
      createdAt: "2026-08-12T00:05:00.000Z",
    });
    const service = new VerificationService({
      unitOfWork: harness.unitOfWork,
      clock,
      idGenerator: ids(
        "verification-2",
        "check-1",
        "check-2",
        "evidence-1",
        "evidence-2",
      ),
      hashEvidence,
    });
    service.startVerification({
      organizationId: ORG,
      findingId: base.id,
      remediationId: "remediation-2",
      method: "Independent manual retest",
      workerName: "Operator",
      scope: "Patient Portal API",
      checks: ["Primary query path", "Secondary query path"],
      actor,
    });
    for (const [sequence, name] of [
      [1, "Primary query path"],
      [2, "Secondary query path"],
    ] as const) {
      service.recordVerificationCheck({
        organizationId: ORG,
        verificationId: "verification-2",
        sequence,
        name,
        status: "Passed",
        message: "No injection reproduced",
        actor,
      });
    }

    const completion = service.completeVerification({
      organizationId: ORG,
      verificationId: "verification-2",
      result: "Passed",
      summary: "Both query paths resist injection",
      evidence: [
        {
          kind: "verification-result",
          label: "Primary retest",
          sourceReference: "verification://verification-2/primary",
          metadata: JSON.parse(
            '{"__proto__":{"preserved":true},"path":"primary","result":"Passed"}',
          ) as Record<string, unknown>,
        },
        {
          kind: "verification-result",
          label: "Secondary retest",
          sourceReference: "verification://verification-2/secondary",
          metadata: { path: "secondary", result: "Passed" },
        },
      ],
      actor,
    });

    expect(completion.verification.status).toBe("Passed");
    expect(completion.finding.state).toBe("Verified fixed");
    expect(completion.evidence).toHaveLength(2);
    expect(completion.evidence.every((item) => item.lockedAt === NOW)).toBe(
      true,
    );
    expect(
      completion.evidence.every((item) =>
        /^[0-9a-f]{64}$/.test(item.contentHash),
      ),
    ).toBe(true);
    expect(
      Object.prototype.hasOwnProperty.call(
        completion.evidence[0]?.metadata,
        "__proto__",
      ),
    ).toBe(true);
    expect(harness.state.verifications.map((run) => run.status)).toEqual([
      "Failed",
      "Passed",
    ]);
    expect(
      harness.state.checks.find((check) => check.id === "check-old"),
    ).toMatchObject({
      status: "Failed",
      message: "Secondary query path remains vulnerable",
    });
    expect(harness.state.auditEvents.map((event) => event.action)).toEqual([
      "verification.started",
      "verification.check_recorded",
      "verification.check_recorded",
      "verification.passed",
      "evidence.locked",
      "evidence.locked",
    ]);
  });
});

describe("DashboardService", () => {
  it("derives metrics, queue, risk summaries, activity, notifications, and latest report from repositories", () => {
    const findings = [
      finding("finding-failed", "SEC-1042", "Verification failed", {
        severity: "Critical",
        slaDueAt: "2026-08-19T00:00:00.000Z",
      }),
      finding("finding-awaiting", "SEC-1067", "Awaiting verification", {
        severity: "Critical",
      }),
      finding("finding-open", "SEC-1081", "Needs remediation"),
      finding("finding-verified", "SEC-1073", "Verified fixed"),
    ];
    const harness = createHarness(findings);
    harness.state.verifications.push({
      id: "verification-failed",
      findingId: "finding-failed",
      remediationId: "remediation-1",
      status: "Failed",
      method: "Retest",
      workerName: "Operator",
      scope: "API",
      resultSummary: "Still vulnerable",
      startedAt: "2026-08-19T10:00:00.000Z",
      completedAt: "2026-08-19T10:10:00.000Z",
      createdAt: "2026-08-19T10:00:00.000Z",
    });
    harness.state.reports.push({
      id: "report-latest",
      companyId: COMPANY_ID,
      title: "Latest report",
      periodLabel: "August 2026",
      status: "Ready",
      snapshot: {
        companyName: company.name,
        riskScore: company.riskScore,
        criticalFindings: 1,
        highFindings: 2,
        verifiedFixes: 1,
        slaCompliancePercent: 75,
        findings: [],
        verificationHistory: [],
      },
      generatedAt: "2026-08-20T11:00:00.000Z",
      createdAt: "2026-08-20T11:00:00.000Z",
    });
    const service = new DashboardService({
      repositories: harness.repositories,
    });

    const snapshot = service.getDashboard({
      organizationId: ORG,
      sort: "priority",
      includeVerified: false,
      page: 1,
      pageSize: 25,
    });

    expect(snapshot.metrics).toEqual({
      managedCompanies: 1,
      openFindings: 3,
      awaitingVerification: 1,
      verificationFailed: 1,
      verifiedFixed: 1,
      slaBreaches: 1,
    });
    expect(snapshot.actionQueue.map((item) => item.findingKey)).toEqual([
      "SEC-1042",
      "SEC-1067",
      "SEC-1081",
    ]);
    expect(snapshot.companies[0]).toMatchObject({
      companyName: "Juniper Ridge Dental",
      openFindings: 3,
      awaitingVerification: 1,
      verificationFailed: 1,
    });
    expect(snapshot.verificationActivity[0]).toMatchObject({
      verificationId: "verification-failed",
      findingKey: "SEC-1042",
      status: "Failed",
    });
    expect(snapshot.notifications.map((item) => item.id)).toEqual(
      expect.arrayContaining(["verification-failed", "sla-breaches"]),
    );
    expect(snapshot.latestReport?.id).toBe("report-latest");
  });
});

describe("ReportService", () => {
  it("creates immutable report snapshots and regeneration inserts a new row", () => {
    const base = finding("finding-1042", "SEC-1042", "Verification failed", {
      severity: "Critical",
      slaDueAt: "2026-08-19T00:00:00.000Z",
    });
    const harness = createHarness([base]);
    const service = new ReportService({
      unitOfWork: harness.unitOfWork,
      clock,
      idGenerator: ids("report-a", "report-b"),
    });

    const reportA = service.createReport({
      organizationId: ORG,
      companyId: COMPANY_ID,
      periodLabel: "August 2026",
      actor,
    });
    const snapshotA = structuredClone(reportA.snapshot);

    harness.state.findings[0] = {
      ...harness.state.findings[0]!,
      state: "Verified fixed",
      updatedAt: NOW,
    };

    const reportB = service.createReport({
      organizationId: ORG,
      companyId: COMPANY_ID,
      periodLabel: "August 2026 refreshed",
      actor,
    });

    expect(reportA.id).toBe("report-a");
    expect(reportB.id).toBe("report-b");
    expect(harness.state.reports).toHaveLength(2);
    expect(harness.state.reports[0]?.snapshot).toEqual(snapshotA);
    expect(reportA.snapshot.findings[0]?.state).toBe("Verification failed");
    expect(reportB.snapshot.findings[0]?.state).toBe("Verified fixed");
    expect(harness.state.auditEvents.map((event) => event.action)).toEqual([
      "report.generated",
      "report.generated",
    ]);
  });
});
