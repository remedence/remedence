import {
  DomainError,
  type Remediation,
  type RemediationRepository,
} from "@remedence/core";
import { getDatabaseConnection, type RemedenceDatabase } from "../database.js";
import { mapRemediationRow } from "../rows.js";

const REMEDIATION_COLUMNS = `
  id,
  finding_id,
  status,
  summary,
  reference,
  owner,
  started_at,
  completed_at,
  created_at,
  updated_at
`;

function requireOneChange(
  changes: number | bigint,
  remediationId: string,
): void {
  if (changes === 1 || changes === 1n) return;
  throw new DomainError(
    "CONCURRENT_STATE_CHANGE",
    409,
    "Remediation state changed concurrently or the remediation no longer exists.",
    { remediationId },
  );
}

export function createRemediationRepository(
  database: RemedenceDatabase,
): RemediationRepository {
  const connection = getDatabaseConnection(database);
  const getByIdStatement = connection.prepare(
    `SELECT ${REMEDIATION_COLUMNS}
     FROM remediations
     WHERE id = ?`,
  );
  const listByFindingStatement = connection.prepare(
    `SELECT ${REMEDIATION_COLUMNS}
     FROM remediations
     WHERE finding_id = ?
     ORDER BY created_at ASC, id ASC`,
  );
  const insertStatement = connection.prepare(
    `INSERT INTO remediations (
       id, finding_id, status, summary, reference, owner, started_at,
       completed_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const completeStatement = connection.prepare(
    `UPDATE remediations
     SET status = 'Completed',
         summary = ?,
         reference = ?,
         completed_at = ?,
         updated_at = ?
     WHERE id = ? AND status = 'In progress'`,
  );

  return {
    getById(id: string): Remediation | undefined {
      const row = getByIdStatement.get(id);
      return row ? mapRemediationRow(row) : undefined;
    },

    listByFinding(findingId: string): Remediation[] {
      return listByFindingStatement.all(findingId).map(mapRemediationRow);
    },

    insert(remediation: Remediation): void {
      insertStatement.run(
        remediation.id,
        remediation.findingId,
        remediation.status,
        remediation.summary,
        remediation.reference,
        remediation.owner,
        remediation.startedAt,
        remediation.completedAt,
        remediation.createdAt,
        remediation.updatedAt,
      );
    },

    complete(id, summary, reference, completedAt, updatedAt): void {
      const result = completeStatement.run(
        summary,
        reference,
        completedAt,
        updatedAt,
        id,
      );
      requireOneChange(result.changes, id);
    },
  };
}
