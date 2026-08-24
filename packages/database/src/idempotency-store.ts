import { getDatabaseConnection, type RemedenceDatabase } from "./database.js";
import { runTransaction } from "./transaction.js";

export interface IdempotencyScope {
  organizationId: string;
  actorId: string;
  key: string;
  operation: string;
  requestHash: string;
}

export interface IdempotencyReplay {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

export type IdempotencyReservation =
  | { outcome: "reserved" }
  | { outcome: "replay"; response: IdempotencyReplay }
  | { outcome: "key-reused" }
  | { outcome: "in-progress" };

export interface IdempotencyStore {
  begin(
    scope: IdempotencyScope,
    createdAt: string,
    expiresAt: string,
  ): IdempotencyReservation;
  complete(
    scope: IdempotencyScope,
    statusCode: number,
    headers: Record<string, string>,
    body: unknown,
    completedAt: string,
  ): void;
  release(scope: IdempotencyScope): void;
}

interface IdempotencyRow {
  operation: string;
  request_hash: string;
  state: "Pending" | "Completed";
  status_code: number | null;
  response_headers_json: string | null;
  response_body_json: string | null;
}

export function createIdempotencyStore(
  database: RemedenceDatabase,
): IdempotencyStore {
  const connection = getDatabaseConnection(database);
  const find = connection.prepare(
    `SELECT operation, request_hash, state, status_code,
            response_headers_json, response_body_json
     FROM idempotency_records
     WHERE organization_id = ? AND actor_id = ? AND idempotency_key = ?`,
  );
  const insert = connection.prepare(
    `INSERT INTO idempotency_records (
       organization_id, actor_id, idempotency_key, operation, request_hash,
       state, created_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, 'Pending', ?, ?)`,
  );
  const finish = connection.prepare(
    `UPDATE idempotency_records
     SET state = 'Completed', status_code = ?, response_headers_json = ?,
         response_body_json = ?, completed_at = ?
     WHERE organization_id = ? AND actor_id = ? AND idempotency_key = ?
       AND operation = ? AND request_hash = ? AND state = 'Pending'`,
  );
  const removePending = connection.prepare(
    `DELETE FROM idempotency_records
     WHERE organization_id = ? AND actor_id = ? AND idempotency_key = ?
       AND operation = ? AND request_hash = ? AND state = 'Pending'`,
  );
  const removeExpired = connection.prepare(
    `DELETE FROM idempotency_records
     WHERE state = 'Completed' AND expires_at < ?`,
  );

  return {
    begin(scope, createdAt, expiresAt) {
      return runTransaction(database, () => {
        removeExpired.run(createdAt);
        const row = find.get(scope.organizationId, scope.actorId, scope.key) as
          IdempotencyRow | undefined;
        if (row) {
          if (
            row.operation !== scope.operation ||
            row.request_hash !== scope.requestHash
          ) {
            return { outcome: "key-reused" } as const;
          }
          if (row.state === "Pending") {
            return { outcome: "in-progress" } as const;
          }
          if (
            row.status_code === null ||
            row.response_headers_json === null ||
            row.response_body_json === null
          ) {
            throw new Error("Completed idempotency record is incomplete.");
          }
          return {
            outcome: "replay",
            response: {
              statusCode: row.status_code,
              headers: JSON.parse(row.response_headers_json) as Record<
                string,
                string
              >,
              body: JSON.parse(row.response_body_json) as unknown,
            },
          } as const;
        }
        insert.run(
          scope.organizationId,
          scope.actorId,
          scope.key,
          scope.operation,
          scope.requestHash,
          createdAt,
          expiresAt,
        );
        return { outcome: "reserved" } as const;
      });
    },

    complete(scope, statusCode, headers, body, completedAt) {
      runTransaction(database, () => {
        const result = finish.run(
          statusCode,
          JSON.stringify(headers),
          JSON.stringify(body),
          completedAt,
          scope.organizationId,
          scope.actorId,
          scope.key,
          scope.operation,
          scope.requestHash,
        );
        if (result.changes !== 1) {
          throw new Error(
            "Idempotency reservation was not completed exactly once.",
          );
        }
      });
    },

    release(scope) {
      runTransaction(database, () => {
        removePending.run(
          scope.organizationId,
          scope.actorId,
          scope.key,
          scope.operation,
          scope.requestHash,
        );
      });
    },
  };
}
