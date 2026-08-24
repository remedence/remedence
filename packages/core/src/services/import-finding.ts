import type {
  Finding,
  FindingState,
  ImportRecord,
  Severity,
} from "../domain/entities.js";
import { DomainError } from "../errors/domain-error.js";
import type { UnitOfWork } from "../ports/repositories.js";
import type { Clock, IdGenerator } from "../ports/runtime.js";

export interface MutationActor {
  actorType: string;
  actorId: string;
}

export interface ImportFindingInput {
  organizationId: string;
  companyId: string;
  findingKey: string;
  title: string;
  description: string;
  source: string;
  severity: Severity;
  state?: FindingState;
  owner: string;
  assetName: string;
  detectedAt: string;
  slaDueAt: string;
  actor: MutationActor;
}

export interface ImportResult {
  importRecord: ImportRecord;
  finding: Finding;
}

export interface ImportFindingServiceDependencies {
  unitOfWork: UnitOfWork;
  clock: Clock;
  idGenerator: IdGenerator;
}

export function normalizeFindingKey(value: string): string {
  return value.trim().toLocaleUpperCase("en-US");
}

function canonicalizeTimestamp(value: string): string {
  return new Date(value).toISOString();
}

export class ImportFindingService {
  constructor(
    private readonly dependencies: ImportFindingServiceDependencies,
  ) {}

  async importFinding(input: ImportFindingInput): Promise<ImportResult> {
    const normalizedKey = normalizeFindingKey(input.findingKey);
    if (input.state !== undefined && input.state !== "Needs remediation") {
      throw new DomainError(
        "INVALID_INITIAL_FINDING_STATE",
        409,
        "Imported findings must begin in Needs remediation.",
        { state: input.state },
      );
    }

    return this.dependencies.unitOfWork.run(async (repositories) => {
      if (
        await repositories.findings.findByKey(
          input.organizationId,
          normalizedKey,
        )
      ) {
        throw new DomainError(
          "DUPLICATE_FINDING",
          409,
          `Finding ${normalizedKey} already exists in this organization.`,
          { findingKey: normalizedKey },
        );
      }

      if (
        !(await repositories.companies.getById(
          input.organizationId,
          input.companyId,
        ))
      ) {
        throw new DomainError(
          "COMPANY_NOT_FOUND",
          404,
          "The target company does not exist in this organization.",
        );
      }

      const now = this.dependencies.clock.now();
      const findingId = this.dependencies.idGenerator.next();
      const finding: Finding = {
        id: findingId,
        organizationId: input.organizationId,
        companyId: input.companyId,
        findingKey: normalizedKey,
        title: input.title,
        description: input.description,
        source: input.source,
        severity: input.severity,
        state: "Needs remediation",
        owner: input.owner,
        assetName: input.assetName,
        detectedAt: canonicalizeTimestamp(input.detectedAt),
        slaDueAt: canonicalizeTimestamp(input.slaDueAt),
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      await repositories.findings.insert(finding);

      const importRecord: ImportRecord = {
        id: this.dependencies.idGenerator.next(),
        source: input.source,
        findingId,
        createdAt: now,
      };
      await repositories.auditEvents.append({
        organizationId: input.organizationId,
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        action: "finding.imported",
        entityType: "finding",
        entityId: findingId,
        details: {
          finding_key: normalizedKey,
          source: input.source,
          import_id: importRecord.id,
        },
        occurredAt: now,
      });

      return { importRecord, finding };
    });
  }
}
