import { createHash } from "node:crypto";
import { getDatabaseConnection, type RemedenceDatabase } from "./database.js";
import { runTransaction } from "./transaction.js";

export interface PrivacyExportSnapshot {
  organizationId: string;
  exportedAt: string;
  records: Record<string, Array<Record<string, unknown>>>;
  artifacts: Array<{
    id: string;
    objectKey: string;
    filename: string;
    contentHash: string;
  }>;
}

export interface DeletionReceipt {
  id: string;
  organizationDigest: string;
  requestedBy: string;
  objectKeys: string[];
  status: "Pending object cleanup" | "Complete";
  lastError: string;
  createdAt: string;
  completedAt: string | null;
}

export type PrivacyStoreResult<T> = T | Promise<T>;

export interface PrivacyStore {
  listPendingDeletionReceipts(): PrivacyStoreResult<DeletionReceipt[]>;
  exportSnapshot(
    organizationId: string,
    exportedAt: string,
  ): PrivacyStoreResult<PrivacyExportSnapshot>;
  setArtifactLegalHold(
    organizationId: string,
    artifactId: string,
    legalHold: boolean,
  ): PrivacyStoreResult<boolean>;
  purgeExpiredUnadoptedArtifacts(input: {
    receiptId: string;
    now: string;
  }): PrivacyStoreResult<DeletionReceipt | undefined>;
  deleteTenant(input: {
    organizationId: string;
    receiptId: string;
    requestedBy: string;
    now: string;
  }): PrivacyStoreResult<DeletionReceipt>;
  completeDeletionReceipt(
    id: string,
    now: string,
    error?: string,
  ): PrivacyStoreResult<void>;
}

interface DeletionReceiptRow {
  id: string;
  organization_digest: string;
  requested_by: string;
  object_keys_json: string;
  status: "Pending object cleanup" | "Complete";
  last_error: string;
  created_at: string;
  completed_at: string | null;
}

function deletionReceiptFrom(row: DeletionReceiptRow): DeletionReceipt {
  return {
    id: row.id,
    organizationDigest: row.organization_digest,
    requestedBy: row.requested_by,
    objectKeys: JSON.parse(row.object_keys_json) as string[],
    status: row.status,
    lastError: row.last_error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

const EXPORT_TABLES = [
  "companies",
  "findings",
  "remediations",
  "verification_runs",
  "verification_checks",
  "evidence_items",
  "reports",
  "audit_events",
  "integration_deliveries",
] as const;

function safeRows(rows: unknown[]): Array<Record<string, unknown>> {
  return rows.map((row) => ({ ...(row as Record<string, unknown>) }));
}

export function createPrivacyStore(database: RemedenceDatabase): PrivacyStore {
  const db = getDatabaseConnection(database);
  return {
    listPendingDeletionReceipts(): DeletionReceipt[] {
      return (
        db
          .prepare(
            `SELECT * FROM privacy_deletion_receipts
             WHERE status = 'Pending object cleanup' ORDER BY created_at, id`,
          )
          .all() as unknown as DeletionReceiptRow[]
      ).map(deletionReceiptFrom);
    },
    exportSnapshot(
      organizationId: string,
      exportedAt: string,
    ): PrivacyExportSnapshot {
      const records: Record<string, Array<Record<string, unknown>>> = {};
      records.organizations = safeRows(
        db
          .prepare("SELECT * FROM organizations WHERE id = ?")
          .all(organizationId),
      );
      for (const table of EXPORT_TABLES) {
        records[table] = safeRows(
          db
            .prepare(`SELECT * FROM ${table} WHERE organization_id = ?`)
            .all(organizationId),
        );
      }
      records.organization_memberships = safeRows(
        db
          .prepare(
            `SELECT organization_id, user_id, role, status, created_at, updated_at
             FROM organization_memberships WHERE organization_id = ?`,
          )
          .all(organizationId),
      );
      records.users = safeRows(
        db
          .prepare(
            `SELECT u.id, u.name, u.email, u.emailVerified, u.image, u.createdAt, u.updatedAt
             FROM user AS u JOIN organization_memberships AS m ON m.user_id = u.id
             WHERE m.organization_id = ? ORDER BY u.id`,
          )
          .all(organizationId),
      );
      records.integration_connections = safeRows(
        db
          .prepare(
            `SELECT organization_id, id, provider, name, status,
                    configuration_json, version, created_at, updated_at
             FROM integration_connections WHERE organization_id = ?`,
          )
          .all(organizationId),
      );
      const artifacts = (
        db
          .prepare(
            `SELECT id, object_key, original_filename, content_hash
             FROM evidence_artifacts WHERE organization_id = ? ORDER BY id`,
          )
          .all(organizationId) as unknown as Array<{
          id: string;
          object_key: string;
          original_filename: string;
          content_hash: string;
        }>
      ).map((row) => ({
        id: row.id,
        objectKey: row.object_key,
        filename: row.original_filename,
        contentHash: row.content_hash,
      }));
      return { organizationId, exportedAt, records, artifacts };
    },

    setArtifactLegalHold(
      organizationId: string,
      artifactId: string,
      legalHold: boolean,
    ): boolean {
      return (
        db
          .prepare(
            `UPDATE evidence_artifacts SET legal_hold = ?
             WHERE organization_id = ? AND id = ?`,
          )
          .run(legalHold ? 1 : 0, organizationId, artifactId).changes === 1
      );
    },

    purgeExpiredUnadoptedArtifacts(input: {
      receiptId: string;
      now: string;
    }): DeletionReceipt | undefined {
      return runTransaction(database, () => {
        const rows = db
          .prepare(
            `SELECT organization_id, id, object_key FROM evidence_artifacts
             WHERE retention_until <= ? AND legal_hold = 0 AND adopted_at IS NULL
             ORDER BY organization_id, id LIMIT 100`,
          )
          .all(input.now) as unknown as Array<{
          organization_id: string;
          id: string;
          object_key: string;
        }>;
        const remove = db.prepare(
          `DELETE FROM evidence_artifacts
           WHERE organization_id = ? AND id = ? AND legal_hold = 0
             AND adopted_at IS NULL AND retention_until <= ?`,
        );
        const keys: string[] = [];
        for (const row of rows) {
          if (
            remove.run(row.organization_id, row.id, input.now).changes === 1
          ) {
            keys.push(row.object_key);
          }
        }
        if (keys.length === 0) return undefined;
        const digest = createHash("sha256")
          .update(
            rows
              .map((row) => row.organization_id)
              .sort()
              .join("\n"),
          )
          .digest("hex");
        db.prepare(
          `INSERT INTO privacy_deletion_receipts
           (id, organization_digest, requested_by, object_keys_json, status,
            last_error, created_at, completed_at)
           VALUES (?, ?, 'retention-worker', ?, 'Pending object cleanup', '', ?, NULL)`,
        ).run(input.receiptId, digest, JSON.stringify(keys), input.now);
        return {
          id: input.receiptId,
          organizationDigest: digest,
          requestedBy: "retention-worker",
          objectKeys: keys,
          status: "Pending object cleanup" as const,
          lastError: "",
          createdAt: input.now,
          completedAt: null,
        };
      });
    },

    deleteTenant(input: {
      organizationId: string;
      receiptId: string;
      requestedBy: string;
      now: string;
    }): DeletionReceipt {
      return runTransaction(database, () => {
        const organization = db
          .prepare("SELECT id FROM organizations WHERE id = ?")
          .get(input.organizationId);
        if (!organization) throw new Error("Organization was not found.");
        const hold = db
          .prepare(
            `SELECT id FROM evidence_artifacts
             WHERE organization_id = ? AND legal_hold = 1 LIMIT 1`,
          )
          .get(input.organizationId);
        if (hold)
          throw new Error("Tenant deletion is blocked by a legal hold.");
        const objectKeys = (
          db
            .prepare(
              "SELECT object_key FROM evidence_artifacts WHERE organization_id = ? ORDER BY id",
            )
            .all(input.organizationId) as unknown as Array<{
            object_key: string;
          }>
        ).map((row) => row.object_key);
        const memberUserIds = (
          db
            .prepare(
              `SELECT user_id FROM organization_memberships
               WHERE organization_id = ? ORDER BY user_id`,
            )
            .all(input.organizationId) as unknown as Array<{ user_id: string }>
        ).map((row) => row.user_id);
        db.prepare(
          `INSERT INTO privacy_deletion_receipts
           (id, organization_digest, requested_by, object_keys_json, status,
            last_error, created_at, completed_at)
           VALUES (?, ?, ?, ?, 'Pending object cleanup', '', ?, NULL)`,
        ).run(
          input.receiptId,
          createHash("sha256").update(input.organizationId).digest("hex"),
          input.requestedBy,
          JSON.stringify(objectKeys),
          input.now,
        );
        const childTables = [
          "evidence_items",
          "evidence_artifacts",
          "verification_execution_receipts",
          "verification_jobs",
          "verification_checks",
          "verification_runs",
          "remediations",
          "reports",
          "findings",
          "companies",
          "audit_events",
          "integration_inbound_events",
          "integration_deliveries",
          "integration_connections",
          "idempotency_records",
          "organization_memberships",
          "organization_privacy_settings",
        ] as const;
        for (const table of childTables) {
          db.prepare(`DELETE FROM ${table} WHERE organization_id = ?`).run(
            input.organizationId,
          );
        }
        db.prepare("DELETE FROM rate_limit_buckets WHERE bucket_key = ?").run(
          `tenant:${input.organizationId}`,
        );
        db.prepare(`DELETE FROM "ssoProvider" WHERE "organizationId" = ?`).run(
          input.organizationId,
        );
        const removeOrphanUser = db.prepare(
          `DELETE FROM "user" WHERE id = ? AND NOT EXISTS (
             SELECT 1 FROM organization_memberships WHERE user_id = ?
           )`,
        );
        for (const userId of memberUserIds) {
          removeOrphanUser.run(userId, userId);
        }
        const deleted = db
          .prepare("DELETE FROM organizations WHERE id = ?")
          .run(input.organizationId).changes;
        if (deleted !== 1) throw new Error("Organization deletion failed.");
        return {
          id: input.receiptId,
          organizationDigest: createHash("sha256")
            .update(input.organizationId)
            .digest("hex"),
          requestedBy: input.requestedBy,
          objectKeys,
          status: "Pending object cleanup" as const,
          lastError: "",
          createdAt: input.now,
          completedAt: null,
        };
      });
    },

    completeDeletionReceipt(id: string, now: string, error = ""): void {
      db.prepare(
        `UPDATE privacy_deletion_receipts
         SET status = ?, last_error = ?, completed_at = ? WHERE id = ?`,
      ).run(
        error ? "Pending object cleanup" : "Complete",
        error,
        error ? null : now,
        id,
      );
    },
  };
}
