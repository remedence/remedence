import type {
  VerificationExecution,
  VerificationExecutionInput,
  VerificationExecutionOutput,
  VerificationExecutionProfile,
  VerificationExecutionReceipt,
  VerificationJob,
  VerificationJobQueue,
  VerificationSandbox,
} from "./index.js";
import { SandboxExecutionError } from "./docker-sandbox.js";

export interface VerificationWorkerSource {
  load(job: VerificationJob): {
    profile: VerificationExecutionProfile;
    input: VerificationExecutionInput;
  };
  apply(
    job: VerificationJob,
    output: VerificationExecutionOutput,
    receipt: VerificationExecutionReceipt,
  ): void;
  cancel(job: VerificationJob, reason: string): void;
}

export interface VerificationWorkerOptions {
  workerId: string;
  queue: VerificationJobQueue;
  source: VerificationWorkerSource;
  sandbox: VerificationSandbox;
  now?: () => string;
  heartbeatMs?: number;
  leaseMs?: number;
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  return new Date(new Date(timestamp).getTime() + milliseconds).toISOString();
}

export class VerificationWorker {
  private readonly now: () => string;
  private readonly heartbeatMs: number;
  private readonly leaseMs: number;

  constructor(private readonly options: VerificationWorkerOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.heartbeatMs = options.heartbeatMs ?? 10_000;
    this.leaseMs = options.leaseMs ?? 30_000;
    if (!options.workerId.trim()) throw new Error("Worker ID is required.");
    if (this.heartbeatMs >= this.leaseMs) {
      throw new Error("Worker heartbeat must be shorter than its queue lease.");
    }
  }

  async runOnce(): Promise<boolean> {
    const claimedAt = this.now();
    const job = this.options.queue.claim({
      workerId: this.options.workerId,
      now: claimedAt,
      leaseExpiresAt: addMilliseconds(claimedAt, this.leaseMs),
    });
    if (!job) return false;

    const controller = new AbortController();
    const heartbeat = setInterval(() => {
      const heartbeatAt = this.now();
      const renewed = this.options.queue.renewLease({
        organizationId: job.organizationId,
        jobId: job.id,
        workerId: this.options.workerId,
        now: heartbeatAt,
        leaseExpiresAt: addMilliseconds(heartbeatAt, this.leaseMs),
      });
      if (!renewed) controller.abort();
    }, this.heartbeatMs);
    heartbeat.unref();

    try {
      const executionRequest = this.options.source.load(job);
      if (
        executionRequest.profile.id !== job.profileId ||
        executionRequest.input.jobId !== job.id ||
        executionRequest.input.attempt !== job.attempt
      ) {
        throw new Error("Worker source returned mismatched job ownership.");
      }
      const execution = await this.options.sandbox.execute(
        executionRequest.profile,
        executionRequest.input,
        this.options.workerId,
        controller.signal,
      );
      this.complete(job, execution);
    } catch (error) {
      const failedAt = this.now();
      const delaySeconds = Math.min(300, 2 ** Math.max(0, job.attempt - 1) * 5);
      this.options.queue.fail({
        organizationId: job.organizationId,
        jobId: job.id,
        workerId: this.options.workerId,
        error:
          error instanceof Error
            ? error.message.slice(0, 2000)
            : "Verification worker failed.",
        retryAt: addMilliseconds(failedAt, delaySeconds * 1000),
        ...(error instanceof SandboxExecutionError
          ? { receipt: error.receipt }
          : {}),
        now: failedAt,
        onCancelled: () =>
          this.options.source.cancel(
            job,
            "Verification execution was cancelled before result adoption.",
          ),
      });
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }

  private complete(job: VerificationJob, execution: VerificationExecution) {
    const current = this.options.queue.get(job.organizationId, job.id);
    if (!current || current.cancellationRequested) {
      throw new Error("Verification job was cancelled before result adoption.");
    }
    this.options.queue.complete(
      {
        organizationId: job.organizationId,
        jobId: job.id,
        workerId: this.options.workerId,
        receipt: execution.receipt,
        now: this.now(),
      },
      () => this.options.source.apply(job, execution.output, execution.receipt),
    );
  }
}
