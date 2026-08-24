import { getDatabaseConnection, type RemedenceDatabase } from "./database.js";
import { runTransaction } from "./transaction.js";

export type IntegrationProvider =
  "generic-webhook" | "github-issues" | "scanner-webhook";
export type IntegrationDeliveryStatus =
  "Queued" | "Running" | "Succeeded" | "Dead letter" | "Cancelled";

export interface ProtectedIntegrationCredential {
  keyVersion: number;
  iv: string;
  ciphertext: string;
  tag: string;
}

export interface IntegrationConnection {
  organizationId: string;
  id: string;
  provider: IntegrationProvider;
  name: string;
  status: "Active" | "Disabled";
  configuration: Record<string, unknown>;
  credential: ProtectedIntegrationCredential;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationDelivery {
  organizationId: string;
  id: string;
  connectionId: string;
  eventKey: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: IntegrationDeliveryStatus;
  attempt: number;
  maxAttempts: number;
  availableAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  responseStatus: number | null;
  responseDigest: string | null;
  lastError: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type IntegrationStoreResult<T> = T | Promise<T>;

export interface IntegrationStore {
  listConnections(
    organizationId: string,
  ): IntegrationStoreResult<IntegrationConnection[]>;
  getConnection(
    organizationId: string,
    id: string,
  ): IntegrationStoreResult<IntegrationConnection | undefined>;
  insertConnection(
    connection: IntegrationConnection,
  ): IntegrationStoreResult<void>;
  disableConnection(
    organizationId: string,
    id: string,
    expectedVersion: number,
    now: string,
  ): IntegrationStoreResult<boolean>;
  enqueue(
    delivery: IntegrationDelivery,
  ): IntegrationStoreResult<IntegrationDelivery>;
  getDelivery(
    organizationId: string,
    id: string,
  ): IntegrationStoreResult<IntegrationDelivery | undefined>;
  listDeliveries(
    organizationId: string,
    connectionId: string,
    limit?: number,
  ): IntegrationStoreResult<IntegrationDelivery[]>;
  claim(
    workerId: string,
    now: string,
    leaseExpiresAt: string,
  ): IntegrationStoreResult<IntegrationDelivery | undefined>;
  settle(input: {
    organizationId: string;
    id: string;
    workerId: string;
    succeeded: boolean;
    responseStatus: number | null;
    responseDigest: string | null;
    error: string;
    retryAt: string;
    now: string;
  }): IntegrationStoreResult<IntegrationDeliveryStatus>;
  retryDeadLetter(
    organizationId: string,
    id: string,
    now: string,
  ): IntegrationStoreResult<boolean>;
  reserveInboundEvent(input: {
    organizationId: string;
    connectionId: string;
    eventKey: string;
    payloadDigest: string;
    receivedAt: string;
  }): IntegrationStoreResult<"accepted" | "duplicate" | "conflict">;
}

interface ConnectionRow {
  organization_id: string;
  id: string;
  provider: IntegrationProvider;
  name: string;
  status: "Active" | "Disabled";
  configuration_json: string;
  credential_key_version: number;
  credential_iv: string;
  credential_ciphertext: string;
  credential_tag: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface DeliveryRow {
  organization_id: string;
  id: string;
  connection_id: string;
  event_key: string;
  event_type: string;
  payload_json: string;
  status: IntegrationDeliveryStatus;
  attempt: number;
  max_attempts: number;
  available_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  response_status: number | null;
  response_digest: string | null;
  last_error: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function connectionFrom(row: ConnectionRow): IntegrationConnection {
  return {
    organizationId: row.organization_id,
    id: row.id,
    provider: row.provider,
    name: row.name,
    status: row.status,
    configuration: JSON.parse(row.configuration_json) as Record<
      string,
      unknown
    >,
    credential: {
      keyVersion: row.credential_key_version,
      iv: row.credential_iv,
      ciphertext: row.credential_ciphertext,
      tag: row.credential_tag,
    },
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deliveryFrom(row: DeliveryRow): IntegrationDelivery {
  return {
    organizationId: row.organization_id,
    id: row.id,
    connectionId: row.connection_id,
    eventKey: row.event_key,
    eventType: row.event_type,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    responseStatus: row.response_status,
    responseDigest: row.response_digest,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

const CONNECTION_COLUMNS = `organization_id, id, provider, name, status,
  configuration_json, credential_key_version, credential_iv,
  credential_ciphertext, credential_tag, version, created_at, updated_at`;
const DELIVERY_COLUMNS = `organization_id, id, connection_id, event_key,
  event_type, payload_json, status, attempt, max_attempts, available_at,
  lease_owner, lease_expires_at, response_status, response_digest, last_error,
  created_at, updated_at, completed_at`;

export function createIntegrationStore(
  database: RemedenceDatabase,
): IntegrationStore {
  const db = getDatabaseConnection(database);
  const getConnection = db.prepare(
    `SELECT ${CONNECTION_COLUMNS} FROM integration_connections
     WHERE organization_id = ? AND id = ?`,
  );
  const getDelivery = db.prepare(
    `SELECT ${DELIVERY_COLUMNS} FROM integration_deliveries
     WHERE organization_id = ? AND id = ?`,
  );
  return {
    listConnections(organizationId: string): IntegrationConnection[] {
      return (
        db
          .prepare(
            `SELECT ${CONNECTION_COLUMNS} FROM integration_connections
             WHERE organization_id = ? ORDER BY name, id`,
          )
          .all(organizationId) as unknown as ConnectionRow[]
      ).map(connectionFrom);
    },
    getConnection(
      organizationId: string,
      id: string,
    ): IntegrationConnection | undefined {
      const row = getConnection.get(organizationId, id) as
        ConnectionRow | undefined;
      return row ? connectionFrom(row) : undefined;
    },
    insertConnection(connection: IntegrationConnection): void {
      db.prepare(
        `INSERT INTO integration_connections (${CONNECTION_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        connection.organizationId,
        connection.id,
        connection.provider,
        connection.name,
        connection.status,
        JSON.stringify(connection.configuration),
        connection.credential.keyVersion,
        connection.credential.iv,
        connection.credential.ciphertext,
        connection.credential.tag,
        connection.version,
        connection.createdAt,
        connection.updatedAt,
      );
    },
    disableConnection(
      organizationId: string,
      id: string,
      expectedVersion: number,
      now: string,
    ): boolean {
      return (
        db
          .prepare(
            `UPDATE integration_connections
             SET status = 'Disabled', version = version + 1, updated_at = ?
             WHERE organization_id = ? AND id = ? AND version = ?`,
          )
          .run(now, organizationId, id, expectedVersion).changes === 1
      );
    },
    enqueue(delivery: IntegrationDelivery): IntegrationDelivery {
      return runTransaction(database, () => {
        db.prepare(
          `INSERT INTO integration_deliveries (${DELIVERY_COLUMNS})
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (organization_id, connection_id, event_key) DO NOTHING`,
        ).run(
          delivery.organizationId,
          delivery.id,
          delivery.connectionId,
          delivery.eventKey,
          delivery.eventType,
          JSON.stringify(delivery.payload),
          delivery.status,
          delivery.attempt,
          delivery.maxAttempts,
          delivery.availableAt,
          delivery.leaseOwner,
          delivery.leaseExpiresAt,
          delivery.responseStatus,
          delivery.responseDigest,
          delivery.lastError,
          delivery.createdAt,
          delivery.updatedAt,
          delivery.completedAt,
        );
        const row = db
          .prepare(
            `SELECT ${DELIVERY_COLUMNS} FROM integration_deliveries
             WHERE organization_id = ? AND connection_id = ? AND event_key = ?`,
          )
          .get(
            delivery.organizationId,
            delivery.connectionId,
            delivery.eventKey,
          ) as unknown as DeliveryRow;
        return deliveryFrom(row);
      });
    },
    getDelivery(
      organizationId: string,
      id: string,
    ): IntegrationDelivery | undefined {
      const row = getDelivery.get(organizationId, id) as
        DeliveryRow | undefined;
      return row ? deliveryFrom(row) : undefined;
    },
    listDeliveries(
      organizationId: string,
      connectionId: string,
      limit = 50,
    ): IntegrationDelivery[] {
      return (
        db
          .prepare(
            `SELECT ${DELIVERY_COLUMNS} FROM integration_deliveries
             WHERE organization_id = ? AND connection_id = ?
             ORDER BY created_at DESC, id DESC LIMIT ?`,
          )
          .all(organizationId, connectionId, limit) as unknown as DeliveryRow[]
      ).map(deliveryFrom);
    },
    claim(workerId: string, now: string, leaseExpiresAt: string) {
      return runTransaction(database, () => {
        db.prepare(
          `UPDATE integration_deliveries
           SET status = 'Queued', lease_owner = NULL, lease_expires_at = NULL,
               available_at = ?, updated_at = ?
           WHERE status = 'Running' AND lease_expires_at <= ?`,
        ).run(now, now, now);
        const row = db
          .prepare(
            `SELECT ${DELIVERY_COLUMNS} FROM integration_deliveries
             WHERE status = 'Queued' AND available_at <= ?
             ORDER BY available_at, created_at, id LIMIT 1`,
          )
          .get(now) as unknown as DeliveryRow | undefined;
        if (!row) return undefined;
        const changed = db
          .prepare(
            `UPDATE integration_deliveries
             SET status = 'Running', attempt = attempt + 1, lease_owner = ?,
                 lease_expires_at = ?, updated_at = ?
             WHERE organization_id = ? AND id = ? AND status = 'Queued'`,
          )
          .run(
            workerId,
            leaseExpiresAt,
            now,
            row.organization_id,
            row.id,
          ).changes;
        if (changed !== 1) return undefined;
        return deliveryFrom(
          getDelivery.get(
            row.organization_id,
            row.id,
          ) as unknown as DeliveryRow,
        );
      });
    },
    settle(input: {
      organizationId: string;
      id: string;
      workerId: string;
      succeeded: boolean;
      responseStatus: number | null;
      responseDigest: string | null;
      error: string;
      retryAt: string;
      now: string;
    }): IntegrationDeliveryStatus {
      return runTransaction(database, () => {
        const current = getDelivery.get(input.organizationId, input.id) as
          DeliveryRow | undefined;
        if (
          !current ||
          current.status !== "Running" ||
          current.lease_owner !== input.workerId
        ) {
          throw new Error("Integration delivery lost its active lease.");
        }
        const status: IntegrationDeliveryStatus = input.succeeded
          ? "Succeeded"
          : current.attempt >= current.max_attempts
            ? "Dead letter"
            : "Queued";
        const completedAt = status === "Succeeded" ? input.now : null;
        const changed = db
          .prepare(
            `UPDATE integration_deliveries
             SET status = ?, available_at = ?, lease_owner = NULL,
                 lease_expires_at = NULL, response_status = ?,
                 response_digest = ?, last_error = ?, updated_at = ?,
                 completed_at = ?
             WHERE organization_id = ? AND id = ? AND status = 'Running'
               AND lease_owner = ?`,
          )
          .run(
            status,
            input.retryAt,
            input.responseStatus,
            input.responseDigest,
            input.error.slice(0, 2000),
            input.now,
            completedAt,
            input.organizationId,
            input.id,
            input.workerId,
          ).changes;
        if (changed !== 1)
          throw new Error("Integration delivery settlement failed.");
        return status;
      });
    },
    retryDeadLetter(organizationId: string, id: string, now: string): boolean {
      return (
        db
          .prepare(
            `UPDATE integration_deliveries
             SET status = 'Queued', attempt = 0, available_at = ?,
                 last_error = '', updated_at = ?
             WHERE organization_id = ? AND id = ? AND status = 'Dead letter'`,
          )
          .run(now, now, organizationId, id).changes === 1
      );
    },
    reserveInboundEvent(input: {
      organizationId: string;
      connectionId: string;
      eventKey: string;
      payloadDigest: string;
      receivedAt: string;
    }): "accepted" | "duplicate" | "conflict" {
      return runTransaction(database, () => {
        const existing = db
          .prepare(
            `SELECT payload_digest FROM integration_inbound_events
             WHERE organization_id = ? AND connection_id = ? AND event_key = ?`,
          )
          .get(input.organizationId, input.connectionId, input.eventKey) as
          { payload_digest: string } | undefined;
        if (existing) {
          return existing.payload_digest === input.payloadDigest
            ? "duplicate"
            : "conflict";
        }
        db.prepare(
          `INSERT INTO integration_inbound_events
           (organization_id, connection_id, event_key, payload_digest, received_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(
          input.organizationId,
          input.connectionId,
          input.eventKey,
          input.payloadDigest,
          input.receivedAt,
        );
        return "accepted";
      });
    },
  };
}
