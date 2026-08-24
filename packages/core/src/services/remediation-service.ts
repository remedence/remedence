import type { Remediation } from "../domain/entities.js";
import { assertFindingTransition } from "../domain/finding-state.js";
import { assertExpectedVersion } from "../domain/version.js";
import { DomainError } from "../errors/domain-error.js";
import type { UnitOfWork } from "../ports/repositories.js";
import type { Clock, IdGenerator } from "../ports/runtime.js";
import type { MutationActor } from "./import-finding.js";

export interface RemediationServiceDependencies {
  unitOfWork: UnitOfWork;
  clock: Clock;
  idGenerator: IdGenerator;
}

export interface StartRemediationInput {
  organizationId: string;
  findingId: string;
  owner: string;
  summary: string;
  reference: string;
  actor: MutationActor;
  expectedFindingVersion?: number;
}

export interface CompleteRemediationInput {
  organizationId: string;
  remediationId: string;
  summary: string;
  reference: string;
  actor: MutationActor;
  expectedVersion?: number;
}

function requireText(value: string, code: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new DomainError(code, 409, message);
  return trimmed;
}

export class RemediationService {
  constructor(private readonly dependencies: RemediationServiceDependencies) {}

  async startRemediation(input: StartRemediationInput): Promise<Remediation> {
    return this.dependencies.unitOfWork.run(async (repositories) => {
      const finding = await repositories.findings.getById(
        input.organizationId,
        input.findingId,
      );
      if (!finding) {
        throw new DomainError(
          "FINDING_NOT_FOUND",
          404,
          "Finding was not found.",
        );
      }
      assertExpectedVersion(finding.version, input.expectedFindingVersion);
      assertFindingTransition(finding.state, "Remediating");

      const now = this.dependencies.clock.now();
      const remediation: Remediation = {
        organizationId: input.organizationId,
        id: this.dependencies.idGenerator.next(),
        findingId: finding.id,
        status: "In progress",
        summary: requireText(
          input.summary,
          "REMEDIATION_SUMMARY_REQUIRED",
          "Remediation summary is required.",
        ),
        reference: requireText(
          input.reference,
          "REMEDIATION_REFERENCE_REQUIRED",
          "Remediation reference is required.",
        ),
        owner: requireText(
          input.owner,
          "REMEDIATION_OWNER_REQUIRED",
          "Remediation owner is required.",
        ),
        remediatorPrincipalId: input.actor.actorId,
        startedAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      await repositories.remediations.insert(remediation);
      await repositories.findings.updateState(
        input.organizationId,
        finding.id,
        finding.state,
        "Remediating",
        now,
      );
      await repositories.auditEvents.append({
        organizationId: input.organizationId,
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        action: "remediation.started",
        entityType: "remediation",
        entityId: remediation.id,
        details: { finding_id: finding.id, reference: remediation.reference },
        occurredAt: now,
      });
      return remediation;
    });
  }

  async completeRemediation(
    input: CompleteRemediationInput,
  ): Promise<Remediation> {
    return this.dependencies.unitOfWork.run(async (repositories) => {
      const remediation = await repositories.remediations.getById(
        input.organizationId,
        input.remediationId,
      );
      if (!remediation) {
        throw new DomainError(
          "REMEDIATION_NOT_FOUND",
          404,
          "Remediation was not found.",
        );
      }
      assertExpectedVersion(remediation.version, input.expectedVersion);
      const finding = await repositories.findings.getById(
        input.organizationId,
        remediation.findingId,
      );
      if (!finding) {
        throw new DomainError(
          "FINDING_NOT_FOUND",
          404,
          "Finding was not found.",
        );
      }
      if (remediation.status !== "In progress") {
        throw new DomainError(
          "INVALID_REMEDIATION_STATE",
          409,
          "Only an in-progress remediation can be completed.",
        );
      }
      assertFindingTransition(finding.state, "Awaiting verification");

      const summary = requireText(
        input.summary,
        "REMEDIATION_SUMMARY_REQUIRED",
        "Remediation summary is required.",
      );
      const reference = requireText(
        input.reference,
        "REMEDIATION_REFERENCE_REQUIRED",
        "Remediation reference is required.",
      );
      const now = this.dependencies.clock.now();
      await repositories.remediations.complete(
        input.organizationId,
        remediation.id,
        summary,
        reference,
        input.actor.actorId,
        now,
        now,
      );
      await repositories.findings.updateState(
        input.organizationId,
        finding.id,
        finding.state,
        "Awaiting verification",
        now,
      );
      await repositories.auditEvents.append({
        organizationId: input.organizationId,
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        action: "remediation.completed",
        entityType: "remediation",
        entityId: remediation.id,
        details: { finding_id: finding.id, reference },
        occurredAt: now,
      });

      const completed = await repositories.remediations.getById(
        input.organizationId,
        remediation.id,
      );
      if (!completed) {
        throw new DomainError(
          "CONCURRENT_STATE_CHANGE",
          409,
          "Completed remediation could not be reread.",
        );
      }
      return completed;
    });
  }
}
