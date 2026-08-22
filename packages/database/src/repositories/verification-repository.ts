import {
  DomainError,
  type VerificationCheck,
  type VerificationRepository,
  type VerificationRun,
} from "@remedence/core";
import { getDatabaseConnection, type RemedenceDatabase } from "../database.js";
import { mapVerificationCheckRow, mapVerificationRunRow } from "../rows.js";

const VERIFICATION_COLUMNS = `
  id,
  finding_id,
  remediation_id,
  status,
  method,
  worker_name,
  scope,
  result_summary,
  started_at,
  completed_at,
  created_at
`;

const CHECK_COLUMNS = `
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
    /UNIQUE constraint failed:\s*verification_checks\.verification_id,\s*verification_checks\.sequence/i.test(
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
     WHERE id = ?`,
  );
  const listByFindingStatement = connection.prepare(
    `SELECT ${VERIFICATION_COLUMNS}
     FROM verification_runs
     WHERE finding_id = ?
     ORDER BY created_at ASC, id ASC`,
  );
  const insertStatement = connection.prepare(
    `INSERT INTO verification_runs (
       id, finding_id, remediation_id, status, method, worker_name, scope,
       result_summary, started_at, completed_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertCheckStatement = connection.prepare(
    `INSERT INTO verification_checks (
       id, verification_id, sequence, name, status, message, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const recordCheckStatement = connection.prepare(
    `UPDATE verification_checks
     SET status = ?, message = ?
     WHERE verification_id = ?
       AND sequence = ?
       AND name = ?
       AND status = 'Pending'`,
  );
  const listChecksStatement = connection.prepare(
    `SELECT ${CHECK_COLUMNS}
     FROM verification_checks
     WHERE verification_id = ?
     ORDER BY sequence ASC, id ASC`,
  );
  const completeStatement = connection.prepare(
    `UPDATE verification_runs
     SET status = ?, result_summary = ?, completed_at = ?
     WHERE id = ? AND status = 'Running'`,
  );

  return {
    getById(id: string): VerificationRun | undefined {
      const row = getByIdStatement.get(id);
      return row ? mapVerificationRunRow(row) : undefined;
    },

    listByFinding(findingId: string): VerificationRun[] {
      return listByFindingStatement.all(findingId).map(mapVerificationRunRow);
    },

    insert(run: VerificationRun): void {
      insertStatement.run(
        run.id,
        run.findingId,
        run.remediationId,
        run.status,
        run.method,
        run.workerName,
        run.scope,
        run.resultSummary,
        run.startedAt,
        run.completedAt,
        run.createdAt,
      );
    },

    insertCheck(check: VerificationCheck): void {
      try {
        insertCheckStatement.run(
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

    recordCheck(verificationId, sequence, name, status, message): void {
      const result = recordCheckStatement.run(
        status,
        message,
        verificationId,
        sequence,
        name,
      );
      requireOneChange(result.changes, verificationId);
    },

    listChecks(verificationId: string): VerificationCheck[] {
      return listChecksStatement
        .all(verificationId)
        .map(mapVerificationCheckRow);
    },

    complete(id, status, summary, completedAt): void {
      const result = completeStatement.run(status, summary, completedAt, id);
      requireOneChange(result.changes, id);
    },
  };
}
