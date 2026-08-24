import type {
  VerificationExecutionReceipt,
  VerificationJob,
  VerificationJobQueue,
  VerificationJobStatus,
} from "@remedence/verification";
import type {
  IdempotencyReservation,
  IdempotencyScope,
  IdempotencyStore,
} from "./idempotency-store.js";
import type {
  IntegrationConnection,
  IntegrationDelivery,
  IntegrationDeliveryStatus,
  IntegrationStore,
} from "./integration-store.js";
import type { PostgresDatabase } from "./postgres-database.js";
import type {
  DeletionReceipt,
  PrivacyExportSnapshot,
  PrivacyStore,
} from "./privacy-store.js";
import type { RateLimitStore } from "./rate-limit-store.js";

interface OperationalRow<T> {
  payload: T;
}

interface EntityRow<T> {
  payload: T;
}

export function createPostgresRateLimitStore(
  database: PostgresDatabase,
): RateLimitStore {
  return {
    async consume(key, currentTime, windowMs) {
      return database.transaction(async () => {
        await database.query(
          "DELETE FROM remedence_rate_limit_buckets WHERE updated_at < $1",
          [currentTime - windowMs * 10],
        );
        const result = await database.query<{
          window_started_at: string;
          request_count: number;
        }>(
          `INSERT INTO remedence_rate_limit_buckets
             (bucket_key, window_started_at, request_count, updated_at)
           VALUES ($1, $2, 1, $2)
           ON CONFLICT (bucket_key) DO UPDATE SET
             window_started_at = CASE
               WHEN $2 >= remedence_rate_limit_buckets.window_started_at + $3
               THEN $2 ELSE remedence_rate_limit_buckets.window_started_at END,
             request_count = CASE
               WHEN $2 >= remedence_rate_limit_buckets.window_started_at + $3
               THEN 1 ELSE remedence_rate_limit_buckets.request_count + 1 END,
             updated_at = $2
           RETURNING window_started_at, request_count`,
          [key, currentTime, windowMs],
        );
        const row = result.rows[0];
        if (!row) throw new Error("Rate limit bucket was not returned.");
        const startedAt = Number(row.window_started_at);
        return { count: row.request_count, resetAt: startedAt + windowMs };
      });
    },
  };
}

export function createPostgresIdempotencyStore(
  database: PostgresDatabase,
): IdempotencyStore {
  return {
    async begin(scope, createdAt, expiresAt): Promise<IdempotencyReservation> {
      return database.transaction(async () => {
        await database.query(
          `DELETE FROM remedence_idempotency_records
           WHERE state = 'Completed' AND expires_at < $1`,
          [createdAt],
        );
        const inserted = await database.query(
          `INSERT INTO remedence_idempotency_records
             (organization_id, actor_id, idempotency_key, operation,
              request_hash, state, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, 'Pending', $6, $7)
           ON CONFLICT DO NOTHING RETURNING idempotency_key`,
          [
            scope.organizationId,
            scope.actorId,
            scope.key,
            scope.operation,
            scope.requestHash,
            createdAt,
            expiresAt,
          ],
        );
        if (inserted.rowCount === 1) return { outcome: "reserved" };
        const existing = await database.query<{
          operation: string;
          request_hash: string;
          state: "Pending" | "Completed";
          status_code: number | null;
          response_headers: Record<string, string> | null;
          response_body: unknown;
        }>(
          `SELECT operation, request_hash, state, status_code,
                  response_headers, response_body
           FROM remedence_idempotency_records
           WHERE organization_id = $1 AND actor_id = $2 AND idempotency_key = $3
           FOR UPDATE`,
          [scope.organizationId, scope.actorId, scope.key],
        );
        const row = existing.rows[0];
        if (!row) throw new Error("Idempotency record disappeared.");
        if (
          row.operation !== scope.operation ||
          row.request_hash !== scope.requestHash
        ) {
          return { outcome: "key-reused" };
        }
        if (row.state === "Pending") return { outcome: "in-progress" };
        if (row.status_code === null || row.response_headers === null) {
          throw new Error("Completed idempotency record is incomplete.");
        }
        return {
          outcome: "replay",
          response: {
            statusCode: row.status_code,
            headers: row.response_headers,
            body: row.response_body,
          },
        };
      });
    },
    async complete(scope, statusCode, headers, body, completedAt) {
      const result = await database.query(
        `UPDATE remedence_idempotency_records
         SET state = 'Completed', status_code = $1, response_headers = $2::jsonb,
             response_body = $3::jsonb, completed_at = $4
         WHERE organization_id = $5 AND actor_id = $6 AND idempotency_key = $7
           AND operation = $8 AND request_hash = $9 AND state = 'Pending'`,
        [
          statusCode,
          JSON.stringify(headers),
          JSON.stringify(body),
          completedAt,
          scope.organizationId,
          scope.actorId,
          scope.key,
          scope.operation,
          scope.requestHash,
        ],
      );
      if (result.rowCount !== 1) {
        throw new Error(
          "Idempotency reservation was not completed exactly once.",
        );
      }
    },
    async release(scope: IdempotencyScope) {
      await database.query(
        `DELETE FROM remedence_idempotency_records
         WHERE organization_id = $1 AND actor_id = $2 AND idempotency_key = $3
           AND operation = $4 AND request_hash = $5 AND state = 'Pending'`,
        [
          scope.organizationId,
          scope.actorId,
          scope.key,
          scope.operation,
          scope.requestHash,
        ],
      );
    },
  };
}

async function getOperational<T>(
  database: PostgresDatabase,
  organizationId: string,
  kind: string,
  id: string,
): Promise<T | undefined> {
  const result = await database.query<OperationalRow<T>>(
    `SELECT payload FROM remedence_operational_records
     WHERE organization_id = $1 AND record_kind = $2 AND record_id = $3`,
    [organizationId, kind, id],
  );
  return result.rows[0]?.payload;
}

async function putOperational<T extends { organizationId: string; id: string }>(
  database: PostgresDatabase,
  kind: string,
  value: T,
  secondaryKey: string | null,
  status: string,
  availableAt: string | null,
  leaseOwner: string | null,
  leaseExpiresAt: string | null,
  createdAt: string,
  updatedAt: string,
): Promise<void> {
  await database.query(
    `INSERT INTO remedence_operational_records
       (organization_id, record_kind, record_id, secondary_key, status,
        available_at, lease_owner, lease_expires_at, payload, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
    [
      value.organizationId,
      kind,
      value.id,
      secondaryKey,
      status,
      availableAt,
      leaseOwner,
      leaseExpiresAt,
      JSON.stringify(value),
      createdAt,
      updatedAt,
    ],
  );
}

export function createPostgresVerificationJobQueue(
  database: PostgresDatabase,
): VerificationJobQueue {
  return {
    enqueue(job) {
      return putOperational(
        database,
        "verification-job",
        job,
        job.verificationId,
        job.status,
        job.availableAt,
        job.leaseOwner,
        job.leaseExpiresAt,
        job.createdAt,
        job.updatedAt,
      );
    },
    get: (organizationId, id) =>
      getOperational<VerificationJob>(
        database,
        organizationId,
        "verification-job",
        id,
      ),
    async getByVerification(organizationId, verificationId) {
      const result = await database.query<OperationalRow<VerificationJob>>(
        `SELECT payload FROM remedence_operational_records
         WHERE organization_id = $1 AND record_kind = 'verification-job'
           AND secondary_key = $2`,
        [organizationId, verificationId],
      );
      return result.rows[0]?.payload;
    },
    async listReceipts(organizationId, jobId) {
      const result = await database.query<
        OperationalRow<VerificationExecutionReceipt>
      >(
        `SELECT payload FROM remedence_operational_records
         WHERE organization_id = $1 AND record_kind = 'verification-receipt'
           AND secondary_key = $2
         ORDER BY (payload->>'attempt')::integer, record_id`,
        [organizationId, jobId],
      );
      return result.rows.map((row) => row.payload);
    },
    async claim(input) {
      return database.transaction(async () => {
        await database.query(
          `UPDATE remedence_operational_records
           SET status = 'Queued', available_at = $1, lease_owner = NULL,
               lease_expires_at = NULL,
               payload = jsonb_set(
                 jsonb_set(
                   jsonb_set(
                     jsonb_set(payload, '{status}', '"Queued"'),
                     '{availableAt}', to_jsonb($1::text)
                   ), '{leaseOwner}', 'null'
                 ), '{leaseExpiresAt}', 'null'
               ), updated_at = $1
           WHERE record_kind = 'verification-job' AND status = 'Running'
             AND lease_expires_at <= $1`,
          [input.now],
        );
        const candidate = await database.query<
          OperationalRow<VerificationJob> & {
            organization_id: string;
            record_id: string;
          }
        >(
          `SELECT organization_id, record_id, payload
           FROM remedence_operational_records
           WHERE record_kind = 'verification-job' AND status = 'Queued'
             AND available_at <= $1
           ORDER BY available_at, created_at, record_id
           FOR UPDATE SKIP LOCKED LIMIT 1`,
          [input.now],
        );
        const row = candidate.rows[0];
        if (!row) return undefined;
        const job: VerificationJob = {
          ...row.payload,
          status: "Running",
          attempt: row.payload.attempt + 1,
          leaseOwner: input.workerId,
          leaseExpiresAt: input.leaseExpiresAt,
          updatedAt: input.now,
        };
        await database.query(
          `UPDATE remedence_operational_records
           SET status = 'Running', lease_owner = $1, lease_expires_at = $2,
               payload = $3::jsonb, updated_at = $4
           WHERE organization_id = $5 AND record_kind = 'verification-job'
             AND record_id = $6`,
          [
            input.workerId,
            input.leaseExpiresAt,
            JSON.stringify(job),
            input.now,
            row.organization_id,
            row.record_id,
          ],
        );
        return job;
      });
    },
    async renewLease(input) {
      const current = await getOperational<VerificationJob>(
        database,
        input.organizationId,
        "verification-job",
        input.jobId,
      );
      if (!current) return false;
      const next = {
        ...current,
        leaseExpiresAt: input.leaseExpiresAt,
        updatedAt: input.now,
      };
      const result = await database.query(
        `UPDATE remedence_operational_records
         SET lease_expires_at = $1, payload = $2::jsonb, updated_at = $3
         WHERE organization_id = $4 AND record_kind = 'verification-job'
           AND record_id = $5 AND status = 'Running' AND lease_owner = $6`,
        [
          input.leaseExpiresAt,
          JSON.stringify(next),
          input.now,
          input.organizationId,
          input.jobId,
          input.workerId,
        ],
      );
      return result.rowCount === 1;
    },
    async requestCancellation(organizationId, jobId, now, cancelRun) {
      return database.transaction(async () => {
        const current = await getOperational<VerificationJob>(
          database,
          organizationId,
          "verification-job",
          jobId,
        );
        if (!current || !["Queued", "Running"].includes(current.status)) {
          return false;
        }
        const queued = current.status === "Queued";
        const next: VerificationJob = queued
          ? { ...current, status: "Cancelled", updatedAt: now }
          : { ...current, cancellationRequested: true, updatedAt: now };
        const result = await database.query(
          `UPDATE remedence_operational_records
           SET status = $1, payload = $2::jsonb, updated_at = $3
           WHERE organization_id = $4 AND record_kind = 'verification-job'
             AND record_id = $5 AND status = $6`,
          [
            next.status,
            JSON.stringify(next),
            now,
            organizationId,
            jobId,
            current.status,
          ],
        );
        if (result.rowCount !== 1) return false;
        if (queued) await cancelRun?.();
        return true;
      });
    },
    async retryDeadLetter(organizationId, jobId, now) {
      const current = await getOperational<VerificationJob>(
        database,
        organizationId,
        "verification-job",
        jobId,
      );
      if (!current || current.status !== "Dead letter") return false;
      const next: VerificationJob = {
        ...current,
        status: "Queued",
        attempt: 0,
        availableAt: now,
        lastError: "",
        updatedAt: now,
      };
      const result = await database.query(
        `UPDATE remedence_operational_records
         SET status = 'Queued', available_at = $1, payload = $2::jsonb,
             updated_at = $1
         WHERE organization_id = $3 AND record_kind = 'verification-job'
           AND record_id = $4 AND status = 'Dead letter'`,
        [now, JSON.stringify(next), organizationId, jobId],
      );
      return result.rowCount === 1;
    },
    async complete(input, applyResult) {
      await database.transaction(async () => {
        const current = await getOperational<VerificationJob>(
          database,
          input.organizationId,
          "verification-job",
          input.jobId,
        );
        if (
          !current ||
          current.status !== "Running" ||
          current.leaseOwner !== input.workerId ||
          current.cancellationRequested
        ) {
          throw new Error("Verification job completion lost its active lease.");
        }
        await applyResult();
        await putOperational(
          database,
          "verification-receipt",
          {
            ...input.receipt,
            organizationId: input.organizationId,
            id: `${input.jobId}:${input.receipt.attempt}`,
          },
          input.jobId,
          "Stored",
          null,
          null,
          null,
          input.receipt.completedAt,
          input.receipt.completedAt,
        );
        const next: VerificationJob = {
          ...current,
          status: "Succeeded",
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: input.now,
        };
        const result = await database.query(
          `UPDATE remedence_operational_records
           SET status = 'Succeeded', lease_owner = NULL, lease_expires_at = NULL,
               payload = $1::jsonb, updated_at = $2
           WHERE organization_id = $3 AND record_kind = 'verification-job'
             AND record_id = $4 AND status = 'Running' AND lease_owner = $5`,
          [
            JSON.stringify(next),
            input.now,
            input.organizationId,
            input.jobId,
            input.workerId,
          ],
        );
        if (result.rowCount !== 1) {
          throw new Error("Verification job completion lost its active lease.");
        }
      });
    },
    async fail(input): Promise<VerificationJobStatus> {
      return database.transaction(async () => {
        const current = await getOperational<VerificationJob>(
          database,
          input.organizationId,
          "verification-job",
          input.jobId,
        );
        if (
          !current ||
          current.status !== "Running" ||
          current.leaseOwner !== input.workerId
        ) {
          throw new Error("Verification job failure lost its active lease.");
        }
        if (input.receipt) {
          await putOperational(
            database,
            "verification-receipt",
            {
              ...input.receipt,
              organizationId: input.organizationId,
              id: `${input.jobId}:${input.receipt.attempt}`,
            },
            input.jobId,
            "Stored",
            null,
            null,
            null,
            input.receipt.completedAt,
            input.receipt.completedAt,
          );
        }
        const status: VerificationJobStatus = current.cancellationRequested
          ? "Cancelled"
          : current.attempt >= current.maxAttempts
            ? "Dead letter"
            : "Queued";
        if (status === "Cancelled") await input.onCancelled?.();
        const next: VerificationJob = {
          ...current,
          status,
          availableAt: input.retryAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: input.error.slice(0, 2000),
          updatedAt: input.now,
        };
        const result = await database.query(
          `UPDATE remedence_operational_records
           SET status = $1, available_at = $2, lease_owner = NULL,
               lease_expires_at = NULL, payload = $3::jsonb, updated_at = $4
           WHERE organization_id = $5 AND record_kind = 'verification-job'
             AND record_id = $6 AND status = 'Running' AND lease_owner = $7`,
          [
            status,
            input.retryAt,
            JSON.stringify(next),
            input.now,
            input.organizationId,
            input.jobId,
            input.workerId,
          ],
        );
        if (result.rowCount !== 1) {
          throw new Error("Verification job failure lost its active lease.");
        }
        return status;
      });
    },
  };
}

export function createPostgresIntegrationStore(
  database: PostgresDatabase,
): IntegrationStore {
  return {
    async listConnections(organizationId) {
      const result = await database.query<
        OperationalRow<IntegrationConnection>
      >(
        `SELECT payload FROM remedence_operational_records
         WHERE organization_id = $1 AND record_kind = 'integration-connection'
         ORDER BY payload->>'name', record_id`,
        [organizationId],
      );
      return result.rows.map((row) => row.payload);
    },
    getConnection: (organizationId, id) =>
      getOperational<IntegrationConnection>(
        database,
        organizationId,
        "integration-connection",
        id,
      ),
    insertConnection(connection) {
      return putOperational(
        database,
        "integration-connection",
        connection,
        null,
        connection.status,
        null,
        null,
        null,
        connection.createdAt,
        connection.updatedAt,
      );
    },
    async disableConnection(organizationId, id, expectedVersion, now) {
      const current = await getOperational<IntegrationConnection>(
        database,
        organizationId,
        "integration-connection",
        id,
      );
      if (!current) return false;
      const next: IntegrationConnection = {
        ...current,
        status: "Disabled",
        version: current.version + 1,
        updatedAt: now,
      };
      const result = await database.query(
        `UPDATE remedence_operational_records
         SET status = 'Disabled', payload = $1::jsonb, updated_at = $2
         WHERE organization_id = $3 AND record_kind = 'integration-connection'
           AND record_id = $4 AND (payload->>'version')::integer = $5`,
        [JSON.stringify(next), now, organizationId, id, expectedVersion],
      );
      return result.rowCount === 1;
    },
    async enqueue(delivery) {
      return database.transaction(async () => {
        const secondaryKey = `${delivery.connectionId}:${delivery.eventKey}`;
        await database.query(
          `INSERT INTO remedence_operational_records
             (organization_id, record_kind, record_id, secondary_key, status,
              available_at, lease_owner, lease_expires_at, payload, created_at,
              updated_at)
           VALUES ($1, 'integration-delivery', $2, $3, $4, $5, $6, $7,
                   $8::jsonb, $9, $10)
           ON CONFLICT DO NOTHING`,
          [
            delivery.organizationId,
            delivery.id,
            secondaryKey,
            delivery.status,
            delivery.availableAt,
            delivery.leaseOwner,
            delivery.leaseExpiresAt,
            JSON.stringify(delivery),
            delivery.createdAt,
            delivery.updatedAt,
          ],
        );
        const result = await database.query<
          OperationalRow<IntegrationDelivery>
        >(
          `SELECT payload FROM remedence_operational_records
           WHERE organization_id = $1 AND record_kind = 'integration-delivery'
             AND secondary_key = $2`,
          [delivery.organizationId, secondaryKey],
        );
        const persisted = result.rows[0]?.payload;
        if (!persisted) throw new Error("Integration delivery disappeared.");
        return persisted;
      });
    },
    getDelivery: (organizationId, id) =>
      getOperational<IntegrationDelivery>(
        database,
        organizationId,
        "integration-delivery",
        id,
      ),
    async listDeliveries(organizationId, connectionId, limit = 50) {
      const result = await database.query<OperationalRow<IntegrationDelivery>>(
        `SELECT payload FROM remedence_operational_records
         WHERE organization_id = $1 AND record_kind = 'integration-delivery'
           AND payload->>'connectionId' = $2
         ORDER BY created_at DESC, record_id DESC LIMIT $3`,
        [organizationId, connectionId, limit],
      );
      return result.rows.map((row) => row.payload);
    },
    async claim(workerId, now, leaseExpiresAt) {
      return database.transaction(async () => {
        const expired = await database.query<
          OperationalRow<IntegrationDelivery> & {
            organization_id: string;
            record_id: string;
          }
        >(
          `SELECT organization_id, record_id, payload
           FROM remedence_operational_records
           WHERE record_kind = 'integration-delivery' AND status = 'Running'
             AND lease_expires_at <= $1 FOR UPDATE SKIP LOCKED`,
          [now],
        );
        for (const row of expired.rows) {
          const recovered: IntegrationDelivery = {
            ...row.payload,
            status: "Queued",
            availableAt: now,
            leaseOwner: null,
            leaseExpiresAt: null,
            updatedAt: now,
          };
          await database.query(
            `UPDATE remedence_operational_records
             SET status = 'Queued', available_at = $1, lease_owner = NULL,
                 lease_expires_at = NULL, payload = $2::jsonb, updated_at = $1
             WHERE organization_id = $3 AND record_kind = 'integration-delivery'
               AND record_id = $4`,
            [
              now,
              JSON.stringify(recovered),
              row.organization_id,
              row.record_id,
            ],
          );
        }
        const candidate = await database.query<
          OperationalRow<IntegrationDelivery> & {
            organization_id: string;
            record_id: string;
          }
        >(
          `SELECT organization_id, record_id, payload
           FROM remedence_operational_records
           WHERE record_kind = 'integration-delivery' AND status = 'Queued'
             AND available_at <= $1
           ORDER BY available_at, created_at, record_id
           FOR UPDATE SKIP LOCKED LIMIT 1`,
          [now],
        );
        const row = candidate.rows[0];
        if (!row) return undefined;
        const claimed: IntegrationDelivery = {
          ...row.payload,
          status: "Running",
          attempt: row.payload.attempt + 1,
          leaseOwner: workerId,
          leaseExpiresAt,
          updatedAt: now,
        };
        await database.query(
          `UPDATE remedence_operational_records
           SET status = 'Running', lease_owner = $1, lease_expires_at = $2,
               payload = $3::jsonb, updated_at = $4
           WHERE organization_id = $5 AND record_kind = 'integration-delivery'
             AND record_id = $6`,
          [
            workerId,
            leaseExpiresAt,
            JSON.stringify(claimed),
            now,
            row.organization_id,
            row.record_id,
          ],
        );
        return claimed;
      });
    },
    async settle(input): Promise<IntegrationDeliveryStatus> {
      return database.transaction(async () => {
        const current = await getOperational<IntegrationDelivery>(
          database,
          input.organizationId,
          "integration-delivery",
          input.id,
        );
        if (
          !current ||
          current.status !== "Running" ||
          current.leaseOwner !== input.workerId
        ) {
          throw new Error("Integration delivery lost its active lease.");
        }
        const status: IntegrationDeliveryStatus = input.succeeded
          ? "Succeeded"
          : current.attempt >= current.maxAttempts
            ? "Dead letter"
            : "Queued";
        const next: IntegrationDelivery = {
          ...current,
          status,
          availableAt: input.retryAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          responseStatus: input.responseStatus,
          responseDigest: input.responseDigest,
          lastError: input.error.slice(0, 2000),
          updatedAt: input.now,
          completedAt: status === "Succeeded" ? input.now : null,
        };
        const result = await database.query(
          `UPDATE remedence_operational_records
           SET status = $1, available_at = $2, lease_owner = NULL,
               lease_expires_at = NULL, payload = $3::jsonb, updated_at = $4
           WHERE organization_id = $5 AND record_kind = 'integration-delivery'
             AND record_id = $6 AND status = 'Running' AND lease_owner = $7`,
          [
            status,
            input.retryAt,
            JSON.stringify(next),
            input.now,
            input.organizationId,
            input.id,
            input.workerId,
          ],
        );
        if (result.rowCount !== 1) {
          throw new Error("Integration delivery settlement failed.");
        }
        return status;
      });
    },
    async retryDeadLetter(organizationId, id, now) {
      const current = await getOperational<IntegrationDelivery>(
        database,
        organizationId,
        "integration-delivery",
        id,
      );
      if (!current || current.status !== "Dead letter") return false;
      const next: IntegrationDelivery = {
        ...current,
        status: "Queued",
        attempt: 0,
        availableAt: now,
        lastError: "",
        updatedAt: now,
      };
      const result = await database.query(
        `UPDATE remedence_operational_records
         SET status = 'Queued', available_at = $1, payload = $2::jsonb,
             updated_at = $1
         WHERE organization_id = $3 AND record_kind = 'integration-delivery'
           AND record_id = $4 AND status = 'Dead letter'`,
        [now, JSON.stringify(next), organizationId, id],
      );
      return result.rowCount === 1;
    },
    async reserveInboundEvent(input) {
      return database.transaction(async () => {
        const secondaryKey = `${input.connectionId}:${input.eventKey}`;
        const inserted = await database.query(
          `INSERT INTO remedence_operational_records
             (organization_id, record_kind, record_id, secondary_key, status,
              payload, created_at, updated_at)
           VALUES ($1, 'integration-inbound', $2, $3, 'Accepted', $4::jsonb,
                   $5, $5)
           ON CONFLICT DO NOTHING RETURNING record_id`,
          [
            input.organizationId,
            secondaryKey,
            secondaryKey,
            JSON.stringify(input),
            input.receivedAt,
          ],
        );
        if (inserted.rowCount === 1) return "accepted";
        const existing = await database.query<
          OperationalRow<{ payloadDigest: string }>
        >(
          `SELECT payload FROM remedence_operational_records
           WHERE organization_id = $1 AND record_kind = 'integration-inbound'
             AND secondary_key = $2`,
          [input.organizationId, secondaryKey],
        );
        return existing.rows[0]?.payload.payloadDigest === input.payloadDigest
          ? "duplicate"
          : "conflict";
      });
    },
  };
}

function privacyReceiptId(id: string): string {
  return `privacy-receipt:${id}`;
}

export function createPostgresPrivacyStore(
  database: PostgresDatabase,
): PrivacyStore {
  return {
    async listPendingDeletionReceipts() {
      const result = await database.query<OperationalRow<DeletionReceipt>>(
        `SELECT payload FROM remedence_operational_records
         WHERE organization_id = 'privacy-receipts'
           AND record_kind = 'privacy-receipt' AND status = 'Pending object cleanup'
         ORDER BY created_at, record_id`,
      );
      return result.rows.map((row) => row.payload);
    },
    async exportSnapshot(
      organizationId,
      exportedAt,
    ): Promise<PrivacyExportSnapshot> {
      const [organization, entities, audits, memberships, users] =
        await Promise.all([
          database.query<Record<string, unknown> & { id: string }>(
            "SELECT * FROM remedence_organizations WHERE id = $1",
            [organizationId],
          ),
          database.query<{
            entity_type: string;
            payload: Record<string, unknown>;
          }>(
            `SELECT entity_type, payload FROM remedence_entities
             WHERE organization_id = $1 ORDER BY entity_type, entity_id`,
            [organizationId],
          ),
          database.query<Record<string, unknown> & { id: string }>(
            `SELECT * FROM remedence_audit_events
             WHERE organization_id = $1 ORDER BY id`,
            [organizationId],
          ),
          database.query<Record<string, unknown> & { organization_id: string }>(
            `SELECT * FROM organization_memberships
             WHERE organization_id = $1 ORDER BY user_id`,
            [organizationId],
          ),
          database.query<Record<string, unknown> & { id: string }>(
            `SELECT u.id, u.name, u.email, u."emailVerified", u.image,
                    u."createdAt", u."updatedAt"
             FROM "user" u JOIN organization_memberships m ON m.user_id = u.id
             WHERE m.organization_id = $1 ORDER BY u.id`,
            [organizationId],
          ),
        ]);
      const records: Record<string, Array<Record<string, unknown>>> = {
        organizations: organization.rows,
        audit_events: audits.rows,
        organization_memberships: memberships.rows,
        users: users.rows,
      };
      const nameByType: Record<string, string> = {
        company: "companies",
        finding: "findings",
        remediation: "remediations",
        verification: "verification_runs",
        "verification-check": "verification_checks",
        evidence: "evidence_items",
        report: "reports",
        "evidence-artifact": "evidence_artifacts",
      };
      for (const row of entities.rows) {
        const name = nameByType[row.entity_type] ?? row.entity_type;
        (records[name] ??= []).push(row.payload);
      }
      const artifacts = (records.evidence_artifacts ?? []).map((payload) => ({
        id: String(payload.id),
        objectKey: String(payload.objectKey),
        filename: String(payload.originalFilename),
        contentHash: String(payload.contentHash),
      }));
      return { organizationId, exportedAt, records, artifacts };
    },
    async setArtifactLegalHold(organizationId, artifactId, legalHold) {
      const result = await database.query(
        `UPDATE remedence_entities
         SET payload = jsonb_set(payload, '{legalHold}', to_jsonb($3::boolean)),
             updated_at = now()
         WHERE organization_id = $1 AND entity_type = 'evidence-artifact'
           AND entity_id = $2`,
        [organizationId, artifactId, legalHold],
      );
      return result.rowCount === 1;
    },
    async purgeExpiredUnadoptedArtifacts(input) {
      return database.transaction(async () => {
        const result = await database.query<
          EntityRow<EvidenceArtifact> & {
            organization_id: string;
            entity_id: string;
          }
        >(
          `SELECT organization_id, entity_id, payload
           FROM remedence_entities
           WHERE entity_type = 'evidence-artifact'
             AND payload->>'retentionUntil' <= $1
             AND payload->>'legalHold' = 'false'
             AND payload->'adoptedAt' = 'null'::jsonb
           ORDER BY organization_id, entity_id
           FOR UPDATE SKIP LOCKED LIMIT 100`,
          [input.now],
        );
        if (result.rows.length === 0) return undefined;
        const keys = result.rows.map((row) => row.payload.objectKey);
        for (const row of result.rows) {
          await database.query(
            `DELETE FROM remedence_entities
             WHERE organization_id = $1 AND entity_type = 'evidence-artifact'
               AND entity_id = $2`,
            [row.organization_id, row.entity_id],
          );
        }
        const receipt: DeletionReceipt = {
          id: input.receiptId,
          organizationDigest: createHash("sha256")
            .update(
              result.rows
                .map((row) => row.organization_id)
                .sort()
                .join("\n"),
            )
            .digest("hex"),
          requestedBy: "retention-worker",
          objectKeys: keys,
          status: "Pending object cleanup",
          lastError: "",
          createdAt: input.now,
          completedAt: null,
        };
        await putOperational(
          database,
          "privacy-receipt",
          {
            ...receipt,
            organizationId: "privacy-receipts",
            id: privacyReceiptId(receipt.id),
          },
          receipt.id,
          receipt.status,
          null,
          null,
          null,
          input.now,
          input.now,
        );
        return receipt;
      });
    },
    async deleteTenant(input) {
      return database.transaction(async () => {
        const organization = await database.query(
          "SELECT id FROM remedence_organizations WHERE id = $1 FOR UPDATE",
          [input.organizationId],
        );
        if (organization.rowCount !== 1) {
          throw new Error("Organization was not found.");
        }
        const artifacts = await database.query<EntityRow<EvidenceArtifact>>(
          `SELECT payload FROM remedence_entities
           WHERE organization_id = $1 AND entity_type = 'evidence-artifact'`,
          [input.organizationId],
        );
        const members = await database.query<{ user_id: string }>(
          `SELECT user_id FROM organization_memberships
           WHERE organization_id = $1 ORDER BY user_id`,
          [input.organizationId],
        );
        if (artifacts.rows.some((row) => row.payload.legalHold)) {
          throw new Error("Tenant deletion is blocked by a legal hold.");
        }
        const receipt: DeletionReceipt = {
          id: input.receiptId,
          organizationDigest: createHash("sha256")
            .update(input.organizationId)
            .digest("hex"),
          requestedBy: input.requestedBy,
          objectKeys: artifacts.rows.map((row) => row.payload.objectKey),
          status: "Pending object cleanup",
          lastError: "",
          createdAt: input.now,
          completedAt: null,
        };
        await putOperational(
          database,
          "privacy-receipt",
          {
            ...receipt,
            organizationId: "privacy-receipts",
            id: privacyReceiptId(receipt.id),
          },
          receipt.id,
          receipt.status,
          null,
          null,
          null,
          input.now,
          input.now,
        );
        await database.query(
          "DELETE FROM remedence_entities WHERE organization_id = $1",
          [input.organizationId],
        );
        await database.query(
          "DELETE FROM remedence_audit_events WHERE organization_id = $1",
          [input.organizationId],
        );
        await database.query(
          "DELETE FROM remedence_operational_records WHERE organization_id = $1",
          [input.organizationId],
        );
        await database.query(
          "DELETE FROM remedence_idempotency_records WHERE organization_id = $1",
          [input.organizationId],
        );
        await database.query(
          "DELETE FROM organization_memberships WHERE organization_id = $1",
          [input.organizationId],
        );
        await database.query(
          'DELETE FROM "ssoProvider" WHERE "organizationId" = $1',
          [input.organizationId],
        );
        if (members.rows.length > 0) {
          await database.query(
            `DELETE FROM "user" u WHERE u.id = ANY($1::text[])
               AND NOT EXISTS (
                 SELECT 1 FROM organization_memberships m
                 WHERE m.user_id = u.id
               )`,
            [members.rows.map((row) => row.user_id)],
          );
        }
        await database.query(
          "DELETE FROM remedence_organizations WHERE id = $1",
          [input.organizationId],
        );
        return receipt;
      });
    },
    async completeDeletionReceipt(id, now, error = "") {
      const storedId = privacyReceiptId(id);
      const current = await getOperational<
        DeletionReceipt & { organizationId: string; id: string }
      >(database, "privacy-receipts", "privacy-receipt", storedId);
      if (!current) throw new Error("Privacy deletion receipt was not found.");
      const next = {
        ...current,
        status: error
          ? ("Pending object cleanup" as const)
          : ("Complete" as const),
        lastError: error,
        completedAt: error ? null : now,
      };
      await database.query(
        `UPDATE remedence_operational_records
         SET status = $1, payload = $2::jsonb, updated_at = $3
         WHERE organization_id = 'privacy-receipts'
           AND record_kind = 'privacy-receipt' AND record_id = $4`,
        [next.status, JSON.stringify(next), now, storedId],
      );
    },
  };
}
import { createHash } from "node:crypto";
import type { EvidenceArtifact } from "@remedence/core";
