import type { Remediation } from "../domain/entities.js";
import { assertFindingTransition } from "../domain/finding-state.js";
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
}

export interface CompleteRemediationInput {
  organizationId: string;
  remediationId: string;
  summary: string;
  reference: string;
  actor: MutationActor;
}

function requireText(value: string, code: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new DomainError(code, 409, message);
  return trimmed;
}

export class RemediationService {
  constructor(private readonly dependencies: RemediationServiceDependencies) {}

  startRemediation(input: StartRemediationInput): Remediation {
    return this.dependencies.unitOfWork.run((repositories) => {
      const finding = repositories.findings.getById(
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
      assertFindingTransition(finding.state, "Remediating");

      const now = this.dependencies.clock.now();
      const remediation: Remediation = {
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
        startedAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      repositories.remediations.insert(remediation);
      repositories.findings.updateState(
        finding.id,
        finding.state,
        "Remediating",
        now,
      );
      repositories.auditEvents.append({
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

  completeRemediation(input: CompleteRemediationInput): Remediation {
    return this.dependencies.unitOfWork.run((repositories) => {
      const remediation = repositories.remediations.getById(
        input.remediationId,
      );
      if (!remediation) {
        throw new DomainError(
          "REMEDIATION_NOT_FOUND",
          404,
          "Remediation was not found.",
        );
      }
      const finding = repositories.findings.getById(
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
      repositories.remediations.complete(
        remediation.id,
        summary,
        reference,
        now,
        now,
      );
      repositories.findings.updateState(
        finding.id,
        finding.state,
        "Awaiting verification",
        now,
      );
      repositories.auditEvents.append({
        organizationId: input.organizationId,
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        action: "remediation.completed",
        entityType: "remediation",
        entityId: remediation.id,
        details: { finding_id: finding.id, reference },
        occurredAt: now,
      });

      const completed = repositories.remediations.getById(remediation.id);
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
