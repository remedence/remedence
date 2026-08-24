import type {
  VerificationExecutionReceipt,
  VerificationJob,
  VerificationJobQueue,
  VerificationJobStatus,
} from "@remedence/verification";
import { getDatabaseConnection, type RemedenceDatabase } from "./database.js";
import { runTransaction } from "./transaction.js";

interface JobRow {
  organization_id: string;
  id: string;
  verification_id: string;
  profile_id: string;
  status: VerificationJobStatus;
  attempt: number;
  max_attempts: number;
  timeout_seconds: number;
  available_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  cancellation_requested: number;
  last_error: string;
  created_at: string;
  updated_at: string;
}

interface ReceiptRow {
  job_id: string;
  attempt: number;
  worker_id: string;
  profile_id: string;
  image_digest: string;
  command_digest: string;
  started_at: string;
  completed_at: string;
  exit_code: number | null;
  timed_out: number;
  output_hash: string;
  signature: string;
}

const JOB_COLUMNS = `
  organization_id, id, verification_id, profile_id, status, attempt,
  max_attempts, timeout_seconds, available_at, lease_owner, lease_expires_at,
  cancellation_requested, last_error, created_at, updated_at
`;

function mapJob(row: JobRow): VerificationJob {
  return {
    organizationId: row.organization_id,
    id: row.id,
    verificationId: row.verification_id,
    profileId: row.profile_id,
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    timeoutSeconds: row.timeout_seconds,
    availableAt: row.available_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    cancellationRequested: row.cancellation_requested === 1,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReceipt(row: ReceiptRow): VerificationExecutionReceipt {
  return {
    jobId: row.job_id,
    attempt: row.attempt,
    workerId: row.worker_id,
    profileId: row.profile_id,
    imageDigest: row.image_digest,
    commandDigest: row.command_digest,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    exitCode: row.exit_code,
    timedOut: row.timed_out === 1,
    outputHash: row.output_hash,
    signature: row.signature,
  };
}

export function createVerificationJobQueue(
  database: RemedenceDatabase,
): VerificationJobQueue {
  const connection = getDatabaseConnection(database);
  const getById = connection.prepare(
    `SELECT ${JOB_COLUMNS} FROM verification_jobs
     WHERE organization_id = ? AND id = ?`,
  );
  const getByVerification = connection.prepare(
    `SELECT ${JOB_COLUMNS} FROM verification_jobs
     WHERE organization_id = ? AND verification_id = ?`,
  );
  const insertJob = connection.prepare(
    `INSERT INTO verification_jobs (${JOB_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const recoverExpired = connection.prepare(
    `UPDATE verification_jobs
     SET status = CASE WHEN cancellation_requested = 1 THEN 'Cancelled' ELSE 'Queued' END,
         available_at = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
     WHERE status = 'Running' AND lease_expires_at <= ?`,
  );
  const nextJob = connection.prepare(
    `SELECT ${JOB_COLUMNS} FROM verification_jobs
     WHERE status = 'Queued' AND cancellation_requested = 0 AND available_at <= ?
     ORDER BY available_at, created_at, id
     LIMIT 1`,
  );
  const claimJob = connection.prepare(
    `UPDATE verification_jobs
     SET status = 'Running', attempt = attempt + 1, lease_owner = ?,
         lease_expires_at = ?, updated_at = ?
     WHERE organization_id = ? AND id = ? AND status = 'Queued'
       AND cancellation_requested = 0`,
  );
  const renewLease = connection.prepare(
    `UPDATE verification_jobs
     SET lease_expires_at = ?, updated_at = ?
     WHERE organization_id = ? AND id = ? AND status = 'Running'
       AND lease_owner = ? AND cancellation_requested = 0`,
  );
  const cancelQueued = connection.prepare(
    `UPDATE verification_jobs
     SET status = 'Cancelled', cancellation_requested = 1, updated_at = ?
     WHERE organization_id = ? AND id = ? AND status IN ('Queued', 'Dead letter')`,
  );
  const cancelRunning = connection.prepare(
    `UPDATE verification_jobs
     SET cancellation_requested = 1, updated_at = ?
     WHERE organization_id = ? AND id = ? AND status = 'Running'`,
  );
  const retryDeadLetter = connection.prepare(
    `UPDATE verification_jobs
     SET status = 'Queued', attempt = 0, available_at = ?,
         cancellation_requested = 0, updated_at = ?
     WHERE organization_id = ? AND id = ? AND status = 'Dead letter'`,
  );
  const finishJob = connection.prepare(
    `UPDATE verification_jobs
     SET status = 'Succeeded', lease_owner = NULL, lease_expires_at = NULL,
         updated_at = ?
     WHERE organization_id = ? AND id = ? AND status = 'Running'
       AND lease_owner = ? AND cancellation_requested = 0`,
  );
  const retryJob = connection.prepare(
    `UPDATE verification_jobs
     SET status = ?, available_at = ?, lease_owner = NULL, lease_expires_at = NULL,
         last_error = ?, updated_at = ?
     WHERE organization_id = ? AND id = ? AND status = 'Running'
       AND lease_owner = ?`,
  );
  const insertReceipt = connection.prepare(
    `INSERT INTO verification_execution_receipts (
       organization_id, job_id, attempt, worker_id, profile_id, image_digest,
       command_digest, started_at, completed_at, exit_code, timed_out,
       output_hash, signature
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const listReceipts = connection.prepare(
    `SELECT job_id, attempt, worker_id, profile_id, image_digest,
            command_digest, started_at, completed_at, exit_code, timed_out,
            output_hash, signature
     FROM verification_execution_receipts
     WHERE organization_id = ? AND job_id = ?
     ORDER BY attempt`,
  );

  function appendReceipt(
    organizationId: string,
    receipt: VerificationExecutionReceipt,
  ): void {
    insertReceipt.run(
      organizationId,
      receipt.jobId,
      receipt.attempt,
      receipt.workerId,
      receipt.profileId,
      receipt.imageDigest,
      receipt.commandDigest,
      receipt.startedAt,
      receipt.completedAt,
      receipt.exitCode,
      receipt.timedOut ? 1 : 0,
      receipt.outputHash,
      receipt.signature,
    );
  }

  return {
    enqueue(job) {
      insertJob.run(
        job.organizationId,
        job.id,
        job.verificationId,
        job.profileId,
        job.status,
        job.attempt,
        job.maxAttempts,
        job.timeoutSeconds,
        job.availableAt,
        job.leaseOwner,
        job.leaseExpiresAt,
        job.cancellationRequested ? 1 : 0,
        job.lastError,
        job.createdAt,
        job.updatedAt,
      );
    },

    get(organizationId, jobId) {
      const row = getById.get(organizationId, jobId) as JobRow | undefined;
      return row ? mapJob(row) : undefined;
    },

    getByVerification(organizationId, verificationId) {
      const row = getByVerification.get(organizationId, verificationId) as
        JobRow | undefined;
      return row ? mapJob(row) : undefined;
    },

    listReceipts(organizationId, jobId) {
      return (
        listReceipts.all(organizationId, jobId) as unknown as ReceiptRow[]
      ).map(mapReceipt);
    },

    claim(input) {
      return runTransaction(database, () => {
        recoverExpired.run(input.now, input.now, input.now);
        const candidate = nextJob.get(input.now) as JobRow | undefined;
        if (!candidate) return undefined;
        const result = claimJob.run(
          input.workerId,
          input.leaseExpiresAt,
          input.now,
          candidate.organization_id,
          candidate.id,
        );
        if (result.changes !== 1) return undefined;
        const claimed = getById.get(candidate.organization_id, candidate.id) as
          JobRow | undefined;
        if (!claimed) throw new Error("Claimed verification job disappeared.");
        return mapJob(claimed);
      });
    },

    requestCancellation(organizationId, jobId, now, cancelRun) {
      return runTransaction(database, async () => {
        const queued = cancelQueued.run(now, organizationId, jobId);
        if (queued.changes === 1) {
          await cancelRun?.();
          return true;
        }
        return cancelRunning.run(now, organizationId, jobId).changes === 1;
      });
    },

    retryDeadLetter(organizationId, jobId, now) {
      return retryDeadLetter.run(now, now, organizationId, jobId).changes === 1;
    },

    renewLease(input) {
      return (
        renewLease.run(
          input.leaseExpiresAt,
          input.now,
          input.organizationId,
          input.jobId,
          input.workerId,
        ).changes === 1
      );
    },

    complete(input, applyResult) {
      return runTransaction(database, async () => {
        await applyResult();
        appendReceipt(input.organizationId, input.receipt);
        const result = finishJob.run(
          input.now,
          input.organizationId,
          input.jobId,
          input.workerId,
        );
        if (result.changes !== 1) {
          throw new Error("Verification job completion lost its active lease.");
        }
      });
    },

    fail(input) {
      return runTransaction(database, async () => {
        const current = getById.get(input.organizationId, input.jobId) as
          JobRow | undefined;
        if (
          !current ||
          current.status !== "Running" ||
          current.lease_owner !== input.workerId
        ) {
          throw new Error("Verification job failure lost its active lease.");
        }
        if (input.receipt) appendReceipt(input.organizationId, input.receipt);
        const status: VerificationJobStatus = current.cancellation_requested
          ? "Cancelled"
          : current.attempt >= current.max_attempts
            ? "Dead letter"
            : "Queued";
        if (status === "Cancelled") await input.onCancelled?.();
        const result = retryJob.run(
          status,
          input.retryAt,
          input.error,
          input.now,
          input.organizationId,
          input.jobId,
          input.workerId,
        );
        if (result.changes !== 1) {
          throw new Error("Verification job failure was not persisted.");
        }
        return status;
      });
    },
  };
}
