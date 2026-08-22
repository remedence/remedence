import type {
  AuditEvent,
  AuditEventQuery,
  AuditEventRepository,
  Page,
} from "@remedence/core";
import { getDatabaseConnection, type RemedenceDatabase } from "../database.js";
import { mapAuditEventRow } from "../rows.js";

const AUDIT_EVENT_COLUMNS = `
  id,
  organization_id,
  actor_type,
  actor_id,
  action,
  entity_type,
  entity_id,
  details_json,
  occurred_at
`;

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

function readTotal(row: unknown): number {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new TypeError("Audit count query did not return a row.");
  }
  const total = (row as Record<string, unknown>).total;
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) {
    throw new TypeError("Audit count query returned an invalid total.");
  }
  return total;
}

export function createAuditEventRepository(
  database: RemedenceDatabase,
): AuditEventRepository {
  const connection = getDatabaseConnection(database);
  const appendStatement = connection.prepare(
    `INSERT INTO audit_events (
       organization_id, actor_type, actor_id, action, entity_type, entity_id,
       details_json, occurred_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  return {
    append(event: AuditEvent): void {
      appendStatement.run(
        event.organizationId,
        event.actorType,
        event.actorId,
        event.action,
        event.entityType,
        event.entityId,
        JSON.stringify(event.details),
        event.occurredAt,
      );
    },

    list(query: AuditEventQuery): Page<AuditEvent> {
      requirePositiveInteger(query.page, "page");
      requirePositiveInteger(query.pageSize, "pageSize");

      const filters = ["organization_id = ?"];
      const parameters: string[] = [query.organizationId];

      if (query.entityType !== undefined) {
        filters.push("entity_type = ?");
        parameters.push(query.entityType);
      }
      if (query.entityId !== undefined) {
        filters.push("entity_id = ?");
        parameters.push(query.entityId);
      }
      if (query.from !== undefined) {
        filters.push("occurred_at >= ?");
        parameters.push(query.from);
      }
      if (query.to !== undefined) {
        filters.push("occurred_at <= ?");
        parameters.push(query.to);
      }

      const whereSql = filters.join(" AND ");
      const total = readTotal(
        connection
          .prepare(
            `SELECT COUNT(id) AS total FROM audit_events WHERE ${whereSql}`,
          )
          .get(...parameters),
      );
      const offset = (query.page - 1) * query.pageSize;
      const items = connection
        .prepare(
          `SELECT ${AUDIT_EVENT_COLUMNS}
           FROM audit_events
           WHERE ${whereSql}
           ORDER BY id ASC
           LIMIT ? OFFSET ?`,
        )
        .all(...parameters, query.pageSize, offset)
        .map(mapAuditEventRow);

      return {
        items,
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    },
  };
}
