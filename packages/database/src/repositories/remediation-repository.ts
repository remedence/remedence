import {
  DomainError,
  type Remediation,
  type RemediationRepository,
} from "@remedence/core";
import { getDatabaseConnection, type RemedenceDatabase } from "../database.js";
import { mapRemediationRow } from "../rows.js";

const REMEDIATION_COLUMNS = `
  organization_id,
  id,
  finding_id,
  status,
  summary,
  reference,
  owner,
  remediator_principal_id,
  started_at,
  completed_at,
  created_at,
  updated_at,
  version
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
     WHERE organization_id = ? AND id = ?`,
  );
  const listByFindingStatement = connection.prepare(
    `SELECT ${REMEDIATION_COLUMNS}
     FROM remediations
     WHERE organization_id = ? AND finding_id = ?
     ORDER BY created_at ASC, id ASC`,
  );
  const insertStatement = connection.prepare(
    `INSERT INTO remediations (
       organization_id, id, finding_id, status, summary, reference, owner,
       remediator_principal_id, started_at, completed_at, created_at, updated_at,
       version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const completeStatement = connection.prepare(
    `UPDATE remediations
     SET status = 'Completed',
         summary = ?,
         reference = ?,
         remediator_principal_id = ?,
         completed_at = ?,
         updated_at = ?,
         version = version + 1
     WHERE organization_id = ? AND id = ? AND status = 'In progress'`,
  );

  return {
    getById(organizationId: string, id: string): Remediation | undefined {
      const row = getByIdStatement.get(organizationId, id);
      return row ? mapRemediationRow(row) : undefined;
    },

    listByFinding(organizationId: string, findingId: string): Remediation[] {
      return listByFindingStatement
        .all(organizationId, findingId)
        .map(mapRemediationRow);
    },

    insert(remediation: Remediation): void {
      insertStatement.run(
        remediation.organizationId,
        remediation.id,
        remediation.findingId,
        remediation.status,
        remediation.summary,
        remediation.reference,
        remediation.owner,
        remediation.remediatorPrincipalId,
        remediation.startedAt,
        remediation.completedAt,
        remediation.createdAt,
        remediation.updatedAt,
        remediation.version,
      );
    },

    complete(
      organizationId,
      id,
      summary,
      reference,
      remediatorPrincipalId,
      completedAt,
      updatedAt,
    ): void {
      const result = completeStatement.run(
        summary,
        reference,
        remediatorPrincipalId,
        completedAt,
        updatedAt,
        organizationId,
        id,
      );
      requireOneChange(result.changes, id);
    },
  };
}
