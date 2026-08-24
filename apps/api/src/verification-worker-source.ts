import { DomainError } from "@remedence/core";
import type {
  VerificationExecutionOutput,
  VerificationExecutionReceipt,
  VerificationJob,
  VerificationWorkerSource,
} from "@remedence/verification";
import { verifyExecutionReceipt } from "@remedence/verification";
import type { ApiDependencies } from "./dependencies.js";

export class ApiVerificationWorkerSource implements VerificationWorkerSource {
  constructor(
    private readonly dependencies: ApiDependencies,
    private readonly receiptSigningKey: string,
  ) {
    if (receiptSigningKey.length < 32) {
      throw new Error(
        "Worker receipt signing key must be at least 32 characters.",
      );
    }
  }

  async load(job: VerificationJob) {
    const profile = this.dependencies.verificationExecution?.profiles.get(
      job.profileId,
    );
    const run = await this.dependencies.repositories.verifications.getById(
      job.organizationId,
      job.verificationId,
    );
    if (!profile || !run || run.credentialType !== "worker-profile") {
      throw new DomainError(
        "VERIFICATION_JOB_SOURCE_INVALID",
        409,
        "Verification job no longer has an approved profile-bound run.",
      );
    }
    const checks =
      await this.dependencies.repositories.verifications.listChecks(
        job.organizationId,
        run.id,
      );
    return {
      profile,
      input: {
        jobId: job.id,
        attempt: job.attempt,
        sourceRevision: run.sourceRevision,
        patchDigest: run.patchDigest,
        requiredChecks: checks.map((check) => check.name),
      },
    };
  }

  async cancel(job: VerificationJob, reason: string): Promise<void> {
    const run = await this.dependencies.repositories.verifications.getById(
      job.organizationId,
      job.verificationId,
    );
    if (!run || run.status !== "Running") return;
    await this.dependencies.services.verification.cancelVerification({
      organizationId: job.organizationId,
      verificationId: run.id,
      reason,
      actor: {
        actorType: "local_worker",
        actorId: run.verifierPrincipalId,
      },
      expectedVersion: run.version,
    });
  }

  async apply(
    job: VerificationJob,
    output: VerificationExecutionOutput,
    receipt: VerificationExecutionReceipt,
  ): Promise<void> {
    const run = await this.dependencies.repositories.verifications.getById(
      job.organizationId,
      job.verificationId,
    );
    if (
      !run ||
      run.credentialType !== "worker-profile" ||
      receipt.jobId !== job.id ||
      receipt.attempt !== job.attempt ||
      receipt.profileId !== job.profileId ||
      !verifyExecutionReceipt(receipt, this.receiptSigningKey)
    ) {
      throw new DomainError(
        "VERIFICATION_RECEIPT_OWNERSHIP_INVALID",
        409,
        "Execution receipt does not match the active verification job.",
      );
    }
    const actor = {
      actorType: "local_worker",
      actorId: run.verifierPrincipalId,
    } as const;
    for (const check of output.checks) {
      const current =
        await this.dependencies.repositories.verifications.getById(
          job.organizationId,
          run.id,
        );
      if (!current) throw new Error("Verification run disappeared.");
      await this.dependencies.services.verification.recordVerificationCheck({
        organizationId: job.organizationId,
        verificationId: run.id,
        sequence: check.sequence,
        name: check.name,
        status: check.status,
        message: check.message,
        actor,
        expectedVersion: current.version,
      });
    }
    const current = await this.dependencies.repositories.verifications.getById(
      job.organizationId,
      run.id,
    );
    if (!current) throw new Error("Verification run disappeared.");
    await this.dependencies.services.verification.completeVerification({
      organizationId: job.organizationId,
      verificationId: run.id,
      result: output.result,
      summary: output.summary,
      evidence:
        output.result === "Passed"
          ? [
              {
                kind: "worker-execution-receipt",
                label: `Isolated verification ${job.profileId}`,
                sourceReference: `worker-receipt://${job.id}/${job.attempt}`,
                metadata: {
                  worker_id: receipt.workerId,
                  profile_id: receipt.profileId,
                  image_digest: receipt.imageDigest,
                  command_digest: receipt.commandDigest,
                  exit_code: receipt.exitCode,
                  timed_out: receipt.timedOut,
                  started_at: receipt.startedAt,
                  completed_at: receipt.completedAt,
                },
                trustedAttestation: {
                  contentHash: receipt.outputHash,
                  manifestHash: receipt.commandDigest,
                  signature: receipt.signature,
                  attestedBy: receipt.workerId,
                },
              },
            ]
          : [],
      actor,
      expectedVersion: current.version,
    });
  }
}
