import {
  DomainError,
  type VerificationCheck,
  type VerificationRepository,
  type VerificationRun,
} from "@remedence/core";
import { getDatabaseConnection, type RemedenceDatabase } from "../database.js";
import { mapVerificationCheckRow, mapVerificationRunRow } from "../rows.js";

const VERIFICATION_COLUMNS = `
  organization_id,
  id,
  finding_id,
  remediation_id,
  status,
  method,
  worker_name,
  verifier_principal_id,
  credential_type,
  execution_source,
  source_revision,
  patch_digest,
  scope,
  result_summary,
  started_at,
  completed_at,
  created_at,
  version
`;

const CHECK_COLUMNS = `
  organization_id,
  id,
  verification_id,
  sequence,
  name,
  status,
  message,
  created_at
`;

function requireOneChange(
  changes: number | bigint,
  verificationId: string,
): void {
  if (changes === 1 || changes === 1n) return;
  throw new DomainError(
    "CONCURRENT_STATE_CHANGE",
    409,
    "Verification state changed concurrently or the verification no longer exists.",
    { verificationId },
  );
}

function isDuplicateCheckSequence(error: unknown): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed:\s*verification_checks\.organization_id,\s*verification_checks\.verification_id,\s*verification_checks\.sequence/i.test(
      error.message,
    )
  );
}

export function createVerificationRepository(
  database: RemedenceDatabase,
): VerificationRepository {
  const connection = getDatabaseConnection(database);
  const getByIdStatement = connection.prepare(
    `SELECT ${VERIFICATION_COLUMNS}
     FROM verification_runs
     WHERE organization_id = ? AND id = ?`,
  );
  const listByFindingStatement = connection.prepare(
    `SELECT ${VERIFICATION_COLUMNS}
     FROM verification_runs
     WHERE organization_id = ? AND finding_id = ?
     ORDER BY created_at ASC, id ASC`,
  );
  const insertStatement = connection.prepare(
    `INSERT INTO verification_runs (
       organization_id, id, finding_id, remediation_id, status, method,
       worker_name, verifier_principal_id, credential_type, execution_source,
       source_revision, patch_digest, scope, result_summary, started_at,
       completed_at, created_at, version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertCheckStatement = connection.prepare(
    `INSERT INTO verification_checks (
       organization_id, id, verification_id, sequence, name, status, message,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const recordCheckStatement = connection.prepare(
    `UPDATE verification_checks
     SET status = ?, message = ?
     WHERE organization_id = ?
       AND verification_id = ?
       AND sequence = ?
       AND name = ?
       AND status = 'Pending'`,
  );
  const listChecksStatement = connection.prepare(
    `SELECT ${CHECK_COLUMNS}
     FROM verification_checks
     WHERE organization_id = ? AND verification_id = ?
     ORDER BY sequence ASC, id ASC`,
  );
  const incrementVersionStatement = connection.prepare(
    `UPDATE verification_runs SET version = version + 1
     WHERE organization_id = ? AND id = ? AND status = 'Running'`,
  );
  const completeStatement = connection.prepare(
    `UPDATE verification_runs
     SET status = ?, result_summary = ?, completed_at = ?, version = version + 1
     WHERE organization_id = ? AND id = ? AND status = 'Running'`,
  );

  return {
    getById(organizationId: string, id: string): VerificationRun | undefined {
      const row = getByIdStatement.get(organizationId, id);
      return row ? mapVerificationRunRow(row) : undefined;
    },

    listByFinding(
      organizationId: string,
      findingId: string,
    ): VerificationRun[] {
      return listByFindingStatement
        .all(organizationId, findingId)
        .map(mapVerificationRunRow);
    },

    insert(run: VerificationRun): void {
      insertStatement.run(
        run.organizationId,
        run.id,
        run.findingId,
        run.remediationId,
        run.status,
        run.method,
        run.workerName,
        run.verifierPrincipalId,
        run.credentialType,
        run.executionSource,
        run.sourceRevision,
        run.patchDigest,
        run.scope,
        run.resultSummary,
        run.startedAt,
        run.completedAt,
        run.createdAt,
        run.version,
      );
    },

    insertCheck(check: VerificationCheck): void {
      try {
        insertCheckStatement.run(
          check.organizationId,
          check.id,
          check.verificationId,
          check.sequence,
          check.name,
          check.status,
          check.message,
          check.createdAt,
        );
      } catch (error) {
        if (isDuplicateCheckSequence(error)) {
          throw new DomainError(
            "DUPLICATE_VERIFICATION_CHECK",
            409,
            "Verification check sequence already exists for this run.",
            {
              verificationId: check.verificationId,
              sequence: check.sequence,
            },
          );
        }
        throw error;
      }
    },

    recordCheck(
      organizationId,
      verificationId,
      sequence,
      name,
      status,
      message,
    ): void {
      const result = recordCheckStatement.run(
        status,
        message,
        organizationId,
        verificationId,
        sequence,
        name,
      );
      requireOneChange(result.changes, verificationId);
      const versionResult = incrementVersionStatement.run(
        organizationId,
        verificationId,
      );
      requireOneChange(versionResult.changes, verificationId);
    },

    listChecks(
      organizationId: string,
      verificationId: string,
    ): VerificationCheck[] {
      return listChecksStatement
        .all(organizationId, verificationId)
        .map(mapVerificationCheckRow);
    },

    complete(organizationId, id, status, summary, completedAt): void {
      const result = completeStatement.run(
        status,
        summary,
        completedAt,
        organizationId,
        id,
      );
      requireOneChange(result.changes, id);
    },
  };
}
