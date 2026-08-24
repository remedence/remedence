import { DomainError, type VerificationCheck } from "@remedence/core";
import type { VerificationJob } from "@remedence/verification";
import { Router } from "express";
import {
  organizationIdFrom,
  authenticatedPrincipalFrom,
  trustedVerifierFrom,
  verificationActorFrom,
} from "../authentication.js";
import type { ApiDependencies } from "../dependencies.js";
import { requireIfMatch, setEntityTag } from "../entity-tag.js";
import {
  toVerificationCheck,
  toVerificationCompletion,
  toVerificationJob,
  toVerificationWithChecks,
} from "./http-shapes.js";

interface CreateVerificationBody {
  finding_id: string;
  remediation_id: string;
  method: string;
  scope: string;
  source_revision: string;
  patch_digest: string;
  checks: string[];
  profile_id?: string;
}

interface CreateVerificationCheckBody {
  sequence: number;
  name: string;
  status: Exclude<VerificationCheck["status"], "Pending">;
  message: string;
}

interface CompleteVerificationEvidenceBody {
  artifact_id: string;
  kind: string;
  label: string;
  source_reference: string;
  metadata: Record<string, unknown>;
}

interface CompleteVerificationBody {
  result: "Passed" | "Failed";
  summary: string;
  evidence?: CompleteVerificationEvidenceBody[];
}

export function createVerificationsRouter(
  dependencies: ApiDependencies,
): Router {
  const router = Router();

  router.get("/verification-profiles", (_request, response) => {
    const profiles = [
      ...(dependencies.verificationExecution?.profiles.values() ?? []),
    ];
    response.json(
      profiles.map((profile) => ({
        id: profile.id,
        timeout_seconds: profile.timeoutSeconds,
        max_attempts: profile.maxAttempts,
        network: profile.network,
      })),
    );
  });

  router.post("/verifications", async (request, response, next) => {
    try {
      const body = request.body as CreateVerificationBody;
      const execution = dependencies.verificationExecution;
      const profile = body.profile_id
        ? execution?.profiles.get(body.profile_id)
        : undefined;
      if (body.profile_id && !profile) {
        throw new DomainError(
          "VERIFICATION_PROFILE_NOT_FOUND",
          404,
          "The approved verification profile was not found.",
        );
      }
      if (execution?.queuedOnly && !profile) {
        throw new DomainError(
          "VERIFICATION_PROFILE_REQUIRED",
          503,
          "Hosted verification requires an approved isolated execution profile.",
        );
      }
      let job: VerificationJob | undefined;
      const create = async () => {
        const verification =
          await dependencies.services.verification.startVerification({
            organizationId: organizationIdFrom(response),
            findingId: body.finding_id,
            remediationId: body.remediation_id,
            method: body.method,
            scope: body.scope,
            sourceRevision: body.source_revision,
            patchDigest: body.patch_digest,
            verifier: profile
              ? {
                  principalId: `worker-profile:${profile.id}`,
                  displayName: `Isolated worker: ${profile.id}`,
                  credentialType: "worker-profile" as const,
                }
              : trustedVerifierFrom(response),
            checks: body.checks,
            actor: verificationActorFrom(response),
            ...(profile ? { executionSource: "isolated-worker" } : {}),
            expectedFindingVersion: requireIfMatch(
              request,
              "finding",
              body.finding_id,
            ),
          });
        if (profile && execution) {
          const now = dependencies.evidenceProtection.clock.now();
          const queued = {
            organizationId: organizationIdFrom(response),
            id: dependencies.evidenceProtection.idGenerator.next(),
            verificationId: verification.id,
            profileId: profile.id,
            status: "Queued" as const,
            attempt: 0,
            maxAttempts: profile.maxAttempts,
            timeoutSeconds: profile.timeoutSeconds,
            availableAt: now,
            leaseOwner: null,
            leaseExpiresAt: null,
            cancellationRequested: false,
            lastError: "",
            createdAt: now,
            updatedAt: now,
          };
          await execution.queue.enqueue(queued);
          job = queued;
        }
        return verification;
      };
      const verification = dependencies.runAtomically
        ? await dependencies.runAtomically(create)
        : await create();
      const checks = await dependencies.repositories.verifications.listChecks(
        organizationIdFrom(response),
        verification.id,
      );

      response.location(
        `/api/v1/verifications/${encodeURIComponent(verification.id)}`,
      );
      setEntityTag(
        response,
        "verification",
        verification.id,
        verification.version,
      );
      response.status(201).json({
        ...toVerificationWithChecks({
          ...verification,
          checks,
        }),
        ...(job ? { job: toVerificationJob(job) } : {}),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/verification-jobs/:jobId", async (request, response, next) => {
    try {
      const execution = dependencies.verificationExecution;
      const job = execution
        ? await execution.queue.get(
            organizationIdFrom(response),
            request.params.jobId ?? "",
          )
        : undefined;
      if (!job || !execution) {
        throw new DomainError(
          "VERIFICATION_JOB_NOT_FOUND",
          404,
          "Verification job was not found.",
        );
      }
      response.json(
        toVerificationJob(
          job,
          await execution.queue.listReceipts(job.organizationId, job.id),
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/verification-jobs/:jobId/cancel",
    async (request, response, next) => {
      try {
        const principal = authenticatedPrincipalFrom(response);
        if (
          !principal ||
          !["Owner", "Administrator"].includes(principal.role)
        ) {
          throw new DomainError(
            "VERIFICATION_JOB_CANCEL_FORBIDDEN",
            403,
            "Only an owner or administrator can cancel a verification job.",
          );
        }
        const execution = dependencies.verificationExecution;
        const organizationId = organizationIdFrom(response);
        const jobId = request.params.jobId ?? "";
        if (
          !execution ||
          !(await execution.queue.requestCancellation(
            organizationId,
            jobId,
            dependencies.evidenceProtection.clock.now(),
            async () => {
              const job = await execution.queue.get(organizationId, jobId);
              if (!job) throw new Error("Verification job disappeared.");
              const run = await dependencies.repositories.verifications.getById(
                organizationId,
                job.verificationId,
              );
              if (!run) throw new Error("Verification run disappeared.");
              await dependencies.services.verification.cancelVerification({
                organizationId,
                verificationId: run.id,
                reason: "Cancelled by an administrator before execution.",
                actor: verificationActorFrom(response),
                expectedVersion: run.version,
              });
            },
          ))
        ) {
          throw new DomainError(
            "VERIFICATION_JOB_NOT_CANCELLABLE",
            409,
            "Verification job is not queued or running.",
          );
        }
        const job = await execution.queue.get(organizationId, jobId);
        if (!job) throw new Error("Cancelled verification job disappeared.");
        response.json(toVerificationJob(job));
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/verification-jobs/:jobId/retry",
    async (request, response, next) => {
      try {
        const principal = authenticatedPrincipalFrom(response);
        if (
          !principal ||
          !["Owner", "Administrator"].includes(principal.role)
        ) {
          throw new DomainError(
            "VERIFICATION_JOB_RETRY_FORBIDDEN",
            403,
            "Only an owner or administrator can retry a dead-letter job.",
          );
        }
        const execution = dependencies.verificationExecution;
        const organizationId = organizationIdFrom(response);
        const jobId = request.params.jobId ?? "";
        if (
          !execution ||
          !(await execution.queue.retryDeadLetter(
            organizationId,
            jobId,
            dependencies.evidenceProtection.clock.now(),
          ))
        ) {
          throw new DomainError(
            "VERIFICATION_JOB_NOT_RETRYABLE",
            409,
            "Only a dead-letter verification job can be retried.",
          );
        }
        const job = await execution.queue.get(organizationId, jobId);
        if (!job) throw new Error("Retried verification job disappeared.");
        response.json(
          toVerificationJob(
            job,
            await execution.queue.listReceipts(organizationId, jobId),
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/verifications/:verificationId/checks",
    async (request, response, next) => {
      try {
        const body = request.body as CreateVerificationCheckBody;
        const check =
          await dependencies.services.verification.recordVerificationCheck({
            organizationId: organizationIdFrom(response),
            verificationId: request.params.verificationId ?? "",
            sequence: body.sequence,
            name: body.name,
            status: body.status,
            message: body.message,
            actor: verificationActorFrom(response),
            expectedVersion: requireIfMatch(
              request,
              "verification",
              request.params.verificationId ?? "",
            ),
          });
        const updated = await dependencies.repositories.verifications.getById(
          organizationIdFrom(response),
          request.params.verificationId ?? "",
        );
        if (updated) {
          setEntityTag(response, "verification", updated.id, updated.version);
        }
        response.status(201).json(toVerificationCheck(check));
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/verifications/:verificationId/complete",
    async (request, response, next) => {
      try {
        const body = request.body as CompleteVerificationBody;
        const completion =
          await dependencies.services.verification.completeVerification({
            organizationId: organizationIdFrom(response),
            verificationId: request.params.verificationId ?? "",
            result: body.result,
            summary: body.summary,
            evidence: (body.evidence ?? []).map((item) => ({
              artifactId: item.artifact_id,
              kind: item.kind,
              label: item.label,
              sourceReference: item.source_reference,
              metadata: item.metadata,
            })),
            actor: verificationActorFrom(response),
            expectedVersion: requireIfMatch(
              request,
              "verification",
              request.params.verificationId ?? "",
            ),
          });
        setEntityTag(
          response,
          "verification",
          completion.verification.id,
          completion.verification.version,
        );
        response.json(toVerificationCompletion(completion));
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
