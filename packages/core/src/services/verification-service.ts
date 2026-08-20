import type {
  EvidenceItem,
  Finding,
  VerificationCheck,
  VerificationRun,
} from "../domain/entities.js";
import { assertFindingTransition } from "../domain/finding-state.js";
import { DomainError } from "../errors/domain-error.js";
import type { UnitOfWork } from "../ports/repositories.js";
import type { Clock, IdGenerator } from "../ports/runtime.js";
import type { MutationActor } from "./import-finding.js";

export interface EvidenceHashInput {
  kind: string;
  label: string;
  sourceReference: string;
  metadata: Record<string, unknown>;
}

export type EvidenceHasher = (input: EvidenceHashInput) => string;

export interface VerificationEvidenceInput extends EvidenceHashInput {}

export interface VerificationServiceDependencies {
  unitOfWork: UnitOfWork;
  clock: Clock;
  idGenerator: IdGenerator;
  hashEvidence: EvidenceHasher;
}

export interface StartVerificationInput {
  organizationId: string;
  findingId: string;
  remediationId: string;
  method: string;
  workerName: string;
  scope: string;
  checks: string[];
  actor: MutationActor;
}

export interface RecordVerificationCheckInput {
  organizationId: string;
  verificationId: string;
  sequence: number;
  name: string;
  status: Exclude<VerificationCheck["status"], "Pending">;
  message: string;
  actor: MutationActor;
}

export interface CompleteVerificationInput {
  organizationId: string;
  verificationId: string;
  result: "Passed" | "Failed";
  summary: string;
  evidence: VerificationEvidenceInput[];
  actor: MutationActor;
}

export interface VerificationCompletion {
  verification: VerificationRun;
  finding: Finding;
  evidence: EvidenceItem[];
}

function requireText(value: string, code: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new DomainError(code, 409, message);
  return trimmed;
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => cloneJsonValue(item));
  if (value === null || typeof value !== "object") return value;
  const clone: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    Object.defineProperty(clone, key, {
      value: cloneJsonValue(item),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return clone;
}

function cloneMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return cloneJsonValue(metadata) as Record<string, unknown>;
}

function requireRunning(run: VerificationRun): void {
  if (run.status !== "Running") {
    throw new DomainError(
      "INVALID_VERIFICATION_STATE",
      409,
      "Only a running verification can be changed.",
      { status: run.status },
    );
  }
}

function requireOwnedFinding(
  organizationId: string,
  findingId: string,
  getById: (organizationId: string, findingId: string) => Finding | undefined,
): Finding {
  const finding = getById(organizationId, findingId);
  if (!finding) {
    throw new DomainError("FINDING_NOT_FOUND", 404, "Finding was not found.");
  }
  return finding;
}

export class VerificationService {
  constructor(private readonly dependencies: VerificationServiceDependencies) {}

  startVerification(input: StartVerificationInput): VerificationRun {
    return this.dependencies.unitOfWork.run((repositories) => {
      const finding = requireOwnedFinding(
        input.organizationId,
        input.findingId,
        repositories.findings.getById.bind(repositories.findings),
      );
      if (finding.state !== "Awaiting verification") {
        throw new DomainError(
          "INVALID_FINDING_STATE",
          409,
          "Verification can start only while the finding awaits verification.",
          { state: finding.state },
        );
      }

      const remediation = repositories.remediations.getById(
        input.remediationId,
      );
      const completedRemediations = repositories.remediations
        .listByFinding(finding.id)
        .filter((item) => item.status === "Completed");
      if (
        completedRemediations.length === 0 ||
        !remediation ||
        remediation.findingId !== finding.id ||
        remediation.status !== "Completed"
      ) {
        throw new DomainError(
          "COMPLETED_REMEDIATION_REQUIRED",
          409,
          "Verification requires a completed remediation for this finding.",
        );
      }

      const checkNames = input.checks.map((name) =>
        requireText(
          name,
          "VERIFICATION_CHECK_REQUIRED",
          "Verification check names cannot be blank.",
        ),
      );
      if (checkNames.length === 0) {
        throw new DomainError(
          "VERIFICATION_CHECK_REQUIRED",
          409,
          "At least one required verification check is needed.",
        );
      }
      const normalizedNames = new Set<string>();
      for (const name of checkNames) {
        const normalized = name.toLocaleLowerCase("en-US");
        if (normalizedNames.has(normalized)) {
          throw new DomainError(
            "DUPLICATE_VERIFICATION_CHECK",
            409,
            "Verification check names must be unique within a run.",
            { name },
          );
        }
        normalizedNames.add(normalized);
      }

      const now = this.dependencies.clock.now();
      const run: VerificationRun = {
        id: this.dependencies.idGenerator.next(),
        findingId: finding.id,
        remediationId: remediation.id,
        status: "Running",
        method: requireText(
          input.method,
          "VERIFICATION_METHOD_REQUIRED",
          "Verification method is required.",
        ),
        workerName: requireText(
          input.workerName,
          "VERIFICATION_WORKER_REQUIRED",
          "Verification worker name is required.",
        ),
        scope: requireText(
          input.scope,
          "VERIFICATION_SCOPE_REQUIRED",
          "Verification scope is required.",
        ),
        resultSummary: "",
        startedAt: now,
        completedAt: null,
        createdAt: now,
      };
      repositories.verifications.insert(run);
      checkNames.forEach((name, index) => {
        repositories.verifications.insertCheck({
          id: this.dependencies.idGenerator.next(),
          verificationId: run.id,
          sequence: index + 1,
          name,
          status: "Pending",
          message: "",
          createdAt: now,
        });
      });
      repositories.auditEvents.append({
        organizationId: input.organizationId,
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        action: "verification.started",
        entityType: "verification",
        entityId: run.id,
        details: {
          finding_id: finding.id,
          remediation_id: remediation.id,
          required_checks: checkNames.length,
        },
        occurredAt: now,
      });
      return run;
    });
  }

  recordVerificationCheck(
    input: RecordVerificationCheckInput,
  ): VerificationCheck {
    return this.dependencies.unitOfWork.run((repositories) => {
      const run = repositories.verifications.getById(input.verificationId);
      if (!run) {
        throw new DomainError(
          "VERIFICATION_NOT_FOUND",
          404,
          "Verification run was not found.",
        );
      }
      requireOwnedFinding(
        input.organizationId,
        run.findingId,
        repositories.findings.getById.bind(repositories.findings),
      );
      requireRunning(run);

      const expected = repositories.verifications
        .listChecks(run.id)
        .find((check) => check.sequence === input.sequence);
      if (!expected) {
        throw new DomainError(
          "VERIFICATION_CHECK_NOT_FOUND",
          404,
          "The required verification check was not found.",
        );
      }
      if (expected.name !== input.name) {
        throw new DomainError(
          "VERIFICATION_CHECK_MISMATCH",
          409,
          "Verification check name does not match the required sequence.",
        );
      }
      if (expected.status !== "Pending") {
        throw new DomainError(
          "CONCURRENT_STATE_CHANGE",
          409,
          "Verification check has already been recorded.",
        );
      }
      if (input.status === "Failed" && !input.message.trim()) {
        throw new DomainError(
          "VERIFICATION_CHECK_MESSAGE_REQUIRED",
          409,
          "A failed verification check requires a concrete message.",
        );
      }

      repositories.verifications.recordCheck(
        run.id,
        input.sequence,
        input.name,
        input.status,
        input.message,
      );
      const now = this.dependencies.clock.now();
      repositories.auditEvents.append({
        organizationId: input.organizationId,
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        action: "verification.check_recorded",
        entityType: "verification",
        entityId: run.id,
        details: {
          sequence: input.sequence,
          name: input.name,
          status: input.status,
        },
        occurredAt: now,
      });

      const recorded = repositories.verifications
        .listChecks(run.id)
        .find((check) => check.sequence === input.sequence);
      if (!recorded) {
        throw new DomainError(
          "CONCURRENT_STATE_CHANGE",
          409,
          "Recorded verification check could not be reread.",
        );
      }
      return recorded;
    });
  }

  completeVerification(
    input: CompleteVerificationInput,
  ): VerificationCompletion {
    return this.dependencies.unitOfWork.run((repositories) => {
      const run = repositories.verifications.getById(input.verificationId);
      if (!run) {
        throw new DomainError(
          "VERIFICATION_NOT_FOUND",
          404,
          "Verification run was not found.",
        );
      }
      requireRunning(run);
      const finding = requireOwnedFinding(
        input.organizationId,
        run.findingId,
        repositories.findings.getById.bind(repositories.findings),
      );
      if (finding.state !== "Awaiting verification") {
        throw new DomainError(
          "INVALID_FINDING_STATE",
          409,
          "Verification can complete only while the finding awaits verification.",
          { state: finding.state },
        );
      }

      const checks = repositories.verifications.listChecks(run.id);
      const now = this.dependencies.clock.now();
      const summary = input.summary.trim();

      if (input.result === "Failed") {
        if (!summary) {
          throw new DomainError(
            "VERIFICATION_FAILURE_SUMMARY_REQUIRED",
            409,
            "Failed verification requires a nonblank result summary.",
          );
        }
        if (!checks.some((check) => check.status === "Failed")) {
          throw new DomainError(
            "VERIFICATION_FAILED_CHECK_REQUIRED",
            409,
            "Failed verification requires at least one concrete failed check.",
          );
        }

        assertFindingTransition(finding.state, "Verification failed");
        repositories.verifications.complete(run.id, "Failed", summary, now);
        repositories.findings.updateState(
          finding.id,
          finding.state,
          "Verification failed",
          now,
        );
        repositories.auditEvents.append({
          organizationId: input.organizationId,
          actorType: input.actor.actorType,
          actorId: input.actor.actorId,
          action: "verification.failed",
          entityType: "verification",
          entityId: run.id,
          details: { finding_id: finding.id, summary },
          occurredAt: now,
        });
        return {
          verification: repositories.verifications.getById(run.id) ?? {
            ...run,
            status: "Failed",
            resultSummary: summary,
            completedAt: now,
          },
          finding: repositories.findings.getById(
            input.organizationId,
            finding.id,
          ) ?? {
            ...finding,
            state: "Verification failed",
            updatedAt: now,
          },
          evidence: [],
        };
      }

      if (!summary) {
        throw new DomainError(
          "VERIFICATION_SUMMARY_REQUIRED",
          409,
          "Passed verification requires a nonblank result summary.",
        );
      }
      if (
        checks.length === 0 ||
        checks.some((check) => check.status !== "Passed")
      ) {
        throw new DomainError(
          "VERIFICATION_CHECKS_INCOMPLETE",
          409,
          "Every required verification check must be recorded as Passed.",
        );
      }
      if (input.evidence.length === 0) {
        throw new DomainError(
          "VERIFICATION_EVIDENCE_REQUIRED",
          409,
          "Passed verification requires locked evidence.",
        );
      }

      assertFindingTransition(finding.state, "Verified fixed");
      const evidence = input.evidence.map((item): EvidenceItem => {
        const kind = requireText(
          item.kind,
          "EVIDENCE_KIND_REQUIRED",
          "Evidence kind is required.",
        );
        const label = requireText(
          item.label,
          "EVIDENCE_LABEL_REQUIRED",
          "Evidence label is required.",
        );
        const sourceReference = requireText(
          item.sourceReference,
          "EVIDENCE_SOURCE_REQUIRED",
          "Evidence source reference is required.",
        );
        const contentHash = this.dependencies.hashEvidence({
          kind,
          label,
          sourceReference,
          metadata: item.metadata,
        });
        if (!/^[0-9a-f]{64}$/.test(contentHash)) {
          throw new DomainError(
            "INVALID_EVIDENCE_HASH",
            409,
            "Evidence hashing must produce a lowercase SHA-256 digest.",
          );
        }
        return {
          id: this.dependencies.idGenerator.next(),
          findingId: finding.id,
          verificationId: run.id,
          kind,
          label,
          sourceReference,
          contentHash,
          metadata: cloneMetadata(item.metadata),
          createdAt: now,
          lockedAt: now,
        };
      });

      for (const item of evidence) repositories.evidence.insert(item);
      repositories.verifications.complete(run.id, "Passed", summary, now);
      repositories.findings.updateState(
        finding.id,
        finding.state,
        "Verified fixed",
        now,
      );
      repositories.auditEvents.append({
        organizationId: input.organizationId,
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        action: "verification.passed",
        entityType: "verification",
        entityId: run.id,
        details: {
          finding_id: finding.id,
          summary,
          evidence_count: evidence.length,
        },
        occurredAt: now,
      });
      for (const item of evidence) {
        repositories.auditEvents.append({
          organizationId: input.organizationId,
          actorType: input.actor.actorType,
          actorId: input.actor.actorId,
          action: "evidence.locked",
          entityType: "evidence",
          entityId: item.id,
          details: {
            finding_id: finding.id,
            verification_id: run.id,
          },
          occurredAt: now,
        });
      }

      return {
        verification: repositories.verifications.getById(run.id) ?? {
          ...run,
          status: "Passed",
          resultSummary: summary,
          completedAt: now,
        },
        finding: repositories.findings.getById(
          input.organizationId,
          finding.id,
        ) ?? {
          ...finding,
          state: "Verified fixed",
          updatedAt: now,
        },
        evidence,
      };
    });
  }
}
