import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  VerificationExecutionReceipt,
  VerificationJob,
} from "@remedence/verification";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  openRemedenceDatabase,
  type RemedenceDatabase,
} from "../src/database.js";
import { applyMigrations } from "../src/migrations.js";
import { seedHarborline } from "../src/seed.js";
import { createVerificationJobQueue } from "../src/verification-job-queue.js";

const migrationsDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
const organizationId = "org-harborline";
const verificationId = "verification-sec-1042-1";
const now = "2026-08-23T12:00:00.000Z";

let directory: string;
let database: RemedenceDatabase;

function job(overrides: Partial<VerificationJob> = {}): VerificationJob {
  return {
    organizationId,
    id: "job-one",
    verificationId,
    profileId: "authorization-regression",
    status: "Queued",
    attempt: 0,
    maxAttempts: 2,
    timeoutSeconds: 60,
    availableAt: now,
    leaseOwner: null,
    leaseExpiresAt: null,
    cancellationRequested: false,
    lastError: "",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function receipt(attempt: number): VerificationExecutionReceipt {
  return {
    jobId: "job-one",
    attempt,
    workerId: "worker-one",
    profileId: "authorization-regression",
    imageDigest: `sha256:${"a".repeat(64)}`,
    commandDigest: "b".repeat(64),
    startedAt: now,
    completedAt: "2026-08-23T12:00:05.000Z",
    exitCode: 0,
    timedOut: false,
    outputHash: "c".repeat(64),
    signature: "d".repeat(64),
  };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "remedence-worker-queue-"));
  database = openRemedenceDatabase({ path: join(directory, "remedence.db") });
  applyMigrations(database, migrationsDirectory);
  seedHarborline(database, { clock: { now: () => now } });
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("verification job queue", () => {
  it("claims one due job with an owner lease and stores its signed receipt", async () => {
    const queue = createVerificationJobQueue(database);
    queue.enqueue(job());

    const claimed = await queue.claim({
      workerId: "worker-one",
      now,
      leaseExpiresAt: "2026-08-23T12:01:00.000Z",
    });
    expect(claimed).toMatchObject({
      status: "Running",
      attempt: 1,
      leaseOwner: "worker-one",
    });
    expect(
      await queue.claim({
        workerId: "worker-two",
        now,
        leaseExpiresAt: "2026-08-23T12:01:00.000Z",
      }),
    ).toBeUndefined();

    let applied = false;
    await queue.complete(
      {
        organizationId,
        jobId: "job-one",
        workerId: "worker-one",
        receipt: receipt(1),
        now: "2026-08-23T12:00:05.000Z",
      },
      () => {
        applied = true;
      },
    );
    expect(applied).toBe(true);
    expect((await queue.get(organizationId, "job-one"))?.status).toBe(
      "Succeeded",
    );
    expect(await queue.listReceipts(organizationId, "job-one")).toEqual([
      receipt(1),
    ]);
  });

  it("recovers expired leases and dead-letters after bounded retries", async () => {
    const queue = createVerificationJobQueue(database);
    queue.enqueue(job());
    queue.claim({
      workerId: "worker-lost",
      now,
      leaseExpiresAt: "2026-08-23T12:00:10.000Z",
    });

    const recovered = await queue.claim({
      workerId: "worker-one",
      now: "2026-08-23T12:00:11.000Z",
      leaseExpiresAt: "2026-08-23T12:01:11.000Z",
    });
    expect(recovered).toMatchObject({ attempt: 2, leaseOwner: "worker-one" });
    expect(
      await queue.fail({
        organizationId,
        jobId: "job-one",
        workerId: "worker-one",
        error: "sandbox unavailable",
        retryAt: "2026-08-23T12:00:20.000Z",
        receipt: receipt(2),
        now: "2026-08-23T12:00:12.000Z",
      }),
    ).toBe("Dead letter");
    expect(await queue.get(organizationId, "job-one")).toMatchObject({
      status: "Dead letter",
      lastError: "sandbox unavailable",
    });
    expect(
      await queue.retryDeadLetter(
        organizationId,
        "job-one",
        "2026-08-23T12:00:20.000Z",
      ),
    ).toBe(true);
    expect(await queue.get(organizationId, "job-one")).toMatchObject({
      status: "Queued",
      attempt: 0,
    });
  });

  it("cancels queued jobs immediately", async () => {
    const queue = createVerificationJobQueue(database);
    queue.enqueue(job());
    let runCancelled = false;
    expect(
      await queue.requestCancellation(organizationId, "job-one", now, () => {
        runCancelled = true;
      }),
    ).toBe(true);
    expect((await queue.get(organizationId, "job-one"))?.status).toBe(
      "Cancelled",
    );
    expect(runCancelled).toBe(true);
  });

  it("marks a running job for cancellation and lets its lease owner settle it", async () => {
    const queue = createVerificationJobQueue(database);
    queue.enqueue(job());
    queue.claim({
      workerId: "worker-one",
      now,
      leaseExpiresAt: "2026-08-23T12:01:00.000Z",
    });
    expect(
      await queue.requestCancellation(organizationId, "job-one", now),
    ).toBe(true);
    expect(
      (await queue.get(organizationId, "job-one"))?.cancellationRequested,
    ).toBe(true);
    let runCancelled = false;
    expect(
      await queue.fail({
        organizationId,
        jobId: "job-one",
        workerId: "worker-one",
        error: "cancelled",
        retryAt: now,
        now,
        onCancelled: () => {
          runCancelled = true;
        },
      }),
    ).toBe("Cancelled");
    expect(runCancelled).toBe(true);
  });
});
