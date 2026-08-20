import type {
  EvidenceItem,
  EvidenceQuery,
  EvidenceRepository,
} from "@remedence/core";
import { getDatabaseConnection, type RemedenceDatabase } from "../database.js";
import { mapEvidenceItemRow } from "../rows.js";

const EVIDENCE_COLUMNS = `
  e.id,
  e.finding_id,
  e.verification_id,
  e.kind,
  e.label,
  e.source_reference,
  e.content_hash,
  e.metadata_json,
  e.created_at,
  e.locked_at
`;

export function createEvidenceRepository(
  database: RemedenceDatabase,
): EvidenceRepository {
  const connection = getDatabaseConnection(database);
  const getByIdStatement = connection.prepare(
    `SELECT ${EVIDENCE_COLUMNS}
     FROM evidence_items AS e
     JOIN findings AS f ON f.id = e.finding_id
     WHERE f.organization_id = ? AND e.id = ?`,
  );
  const insertStatement = connection.prepare(
    `INSERT INTO evidence_items (
       id, finding_id, verification_id, kind, label, source_reference,
       content_hash, metadata_json, created_at, locked_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  return {
    getById(
      organizationId: string,
      evidenceId: string,
    ): EvidenceItem | undefined {
      const row = getByIdStatement.get(organizationId, evidenceId);
      return row ? mapEvidenceItemRow(row) : undefined;
    },

    list(query: EvidenceQuery): EvidenceItem[] {
      const filters = ["f.organization_id = ?"];
      const parameters: Array<string | number> = [query.organizationId];
      if (query.findingId !== undefined) {
        filters.push("e.finding_id = ?");
        parameters.push(query.findingId);
      }
      if (query.verificationId !== undefined) {
        filters.push("e.verification_id = ?");
        parameters.push(query.verificationId);
      }
      if (query.locked !== undefined) {
        filters.push(
          query.locked ? "e.locked_at IS NOT NULL" : "e.locked_at IS NULL",
        );
      }

      return connection
        .prepare(
          `SELECT ${EVIDENCE_COLUMNS}
           FROM evidence_items AS e
           JOIN findings AS f ON f.id = e.finding_id
           WHERE ${filters.join(" AND ")}
           ORDER BY e.created_at ASC, e.id ASC`,
        )
        .all(...parameters)
        .map(mapEvidenceItemRow);
    },

    insert(item: EvidenceItem): void {
      insertStatement.run(
        item.id,
        item.findingId,
        item.verificationId,
        item.kind,
        item.label,
        item.sourceReference,
        item.contentHash,
        JSON.stringify(item.metadata),
        item.createdAt,
        item.lockedAt,
      );
    },
  };
}
