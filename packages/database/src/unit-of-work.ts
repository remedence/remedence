import type { RepositorySet, UnitOfWork } from "@remedence/core";
import type { RemedenceDatabase } from "./database.js";
import { createAuditEventRepository } from "./repositories/audit-event-repository.js";
import { createCompanyRepository } from "./repositories/company-repository.js";
import { createEvidenceRepository } from "./repositories/evidence-repository.js";
import { createFindingRepository } from "./repositories/finding-repository.js";
import { createRemediationRepository } from "./repositories/remediation-repository.js";
import { createReportRepository } from "./repositories/report-repository.js";
import { createVerificationRepository } from "./repositories/verification-repository.js";
import { runTransaction } from "./transaction.js";

export interface RepositorySetOptions {
  referenceTime: string | (() => string);
}

export function createRepositorySet(
  database: RemedenceDatabase,
  options: RepositorySetOptions,
): RepositorySet {
  return {
    companies: createCompanyRepository(database),
    findings: createFindingRepository(database, {
      referenceTime: options.referenceTime,
    }),
    remediations: createRemediationRepository(database),
    verifications: createVerificationRepository(database),
    evidence: createEvidenceRepository(database),
    reports: createReportRepository(database),
    auditEvents: createAuditEventRepository(database),
  };
}

export function createUnitOfWork(
  database: RemedenceDatabase,
  options: RepositorySetOptions,
): UnitOfWork {
  return {
    run<T>(operation: (repositories: RepositorySet) => T | Promise<T>) {
      return runTransaction(database, async () =>
        operation(createRepositorySet(database, options)),
      );
    },
  };
}
