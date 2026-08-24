import type { EvidenceQuery, EvidenceRepository } from "@remedence/core";
import { getDatabaseConnection, type RemedenceDatabase } from "../database.js";
import { decodeCursor, encodeCursor } from "../cursor.js";
import { mapEvidenceArtifactRow, mapEvidenceItemRow } from "../rows.js";

const EVIDENCE_COLUMNS = `
  e.organization_id, e.id, e.finding_id, e.verification_id, e.kind, e.label,
  e.source_reference, e.content_hash, e.artifact_id, e.manifest_hash,
  e.manifest_signature, e.attested_by, e.metadata_json, e.created_at, e.locked_at
`;

export function createEvidenceRepository(
  database: RemedenceDatabase,
): EvidenceRepository {
  const connection = getDatabaseConnection(database);
  const getByIdStatement = connection.prepare(
    `SELECT ${EVIDENCE_COLUMNS} FROM evidence_items AS e
     WHERE e.organization_id = ? AND e.id = ?`,
  );
  const insertStatement = connection.prepare(
    `INSERT INTO evidence_items (
       organization_id, id, finding_id, verification_id, kind, label,
       source_reference, content_hash, artifact_id, manifest_hash,
       manifest_signature, attested_by, metadata_json, created_at, locked_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const getArtifactStatement = connection.prepare(
    `SELECT * FROM evidence_artifacts
     WHERE organization_id = ? AND id = ?`,
  );
  const insertArtifactStatement = connection.prepare(
    `INSERT INTO evidence_artifacts (
       organization_id, id, object_key, content_hash, size_bytes, media_type,
       original_filename, scan_status, scanner, scan_receipt_json, uploaded_by,
       created_at, retention_until, legal_hold, adopted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const adoptArtifactStatement = connection.prepare(
    `UPDATE evidence_artifacts SET adopted_at = ?
     WHERE organization_id = ? AND id = ?
       AND scan_status = 'Clean' AND adopted_at IS NULL`,
  );

  return {
    getById(organizationId, evidenceId) {
      const row = getByIdStatement.get(organizationId, evidenceId);
      return row ? mapEvidenceItemRow(row) : undefined;
    },

    list(query: EvidenceQuery) {
      if (
        !Number.isSafeInteger(query.pageSize) ||
        query.pageSize < 1 ||
        query.pageSize > 100
      ) {
        throw new RangeError("pageSize must be between 1 and 100.");
      }
      const filters = ["e.organization_id = ?"];
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
      const collectionWhereSql = filters.join(" AND ");
      const collectionParameters = [...parameters];
      if (query.cursor !== undefined) {
        const [createdAt, id] = decodeCursor(query.cursor, "evidence", 2);
        if (typeof createdAt !== "string" || typeof id !== "string") {
          throw new RangeError("cursor is invalid for evidence.");
        }
        filters.push("(e.created_at < ? OR (e.created_at = ? AND e.id < ?))");
        parameters.push(createdAt, createdAt, id);
      }
      const totalRow = connection
        .prepare(
          `SELECT COUNT(e.id) AS total FROM evidence_items AS e
           WHERE ${collectionWhereSql}`,
        )
        .get(...collectionParameters) as { total?: unknown } | undefined;
      if (
        typeof totalRow?.total !== "number" ||
        !Number.isSafeInteger(totalRow.total) ||
        totalRow.total < 0
      ) {
        throw new TypeError("Evidence count query returned an invalid total.");
      }
      const rows = connection
        .prepare(
          `SELECT ${EVIDENCE_COLUMNS} FROM evidence_items AS e
           WHERE ${filters.join(" AND ")}
           ORDER BY e.created_at DESC, e.id DESC
           LIMIT ?`,
        )
        .all(...parameters, query.pageSize + 1)
        .map(mapEvidenceItemRow);
      const hasNext = rows.length > query.pageSize;
      const items = hasNext ? rows.slice(0, query.pageSize) : rows;
      const last = items.at(-1);
      return {
        items,
        pageSize: query.pageSize,
        total: totalRow.total,
        nextCursor:
          hasNext && last
            ? encodeCursor("evidence", [last.createdAt, last.id])
            : null,
      };
    },

    insert(item): void {
      insertStatement.run(
        item.organizationId,
        item.id,
        item.findingId,
        item.verificationId,
        item.kind,
        item.label,
        item.sourceReference,
        item.contentHash,
        item.artifactId,
        item.manifestHash,
        item.manifestSignature,
        item.attestedBy,
        JSON.stringify(item.metadata),
        item.createdAt,
        item.lockedAt,
      );
    },

    getArtifact(organizationId, artifactId) {
      const row = getArtifactStatement.get(organizationId, artifactId);
      return row ? mapEvidenceArtifactRow(row) : undefined;
    },

    insertArtifact(artifact): void {
      insertArtifactStatement.run(
        artifact.organizationId,
        artifact.id,
        artifact.objectKey,
        artifact.contentHash,
        artifact.size,
        artifact.mediaType,
        artifact.originalFilename,
        artifact.scanStatus,
        artifact.scanner,
        JSON.stringify(artifact.scanReceipt),
        artifact.uploadedBy,
        artifact.createdAt,
        artifact.retentionUntil,
        artifact.legalHold ? 1 : 0,
        artifact.adoptedAt,
      );
    },

    adoptArtifact(organizationId, artifactId, adoptedAt): boolean {
      return (
        adoptArtifactStatement.run(adoptedAt, organizationId, artifactId)
          .changes === 1
      );
    },
  };
}
