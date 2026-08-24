import type { VerificationCheck } from "@remedence/core";
import { Router } from "express";
import {
  organizationIdFrom,
  trustedVerifierFrom,
  verificationActorFrom,
} from "../authentication.js";
import type { ApiDependencies } from "../dependencies.js";
import {
  toVerificationCheck,
  toVerificationCompletion,
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

  router.post("/verifications", (request, response, next) => {
    try {
      const body = request.body as CreateVerificationBody;
      const verification = dependencies.services.verification.startVerification(
        {
          organizationId: organizationIdFrom(response),
          findingId: body.finding_id,
          remediationId: body.remediation_id,
          method: body.method,
          scope: body.scope,
          sourceRevision: body.source_revision,
          patchDigest: body.patch_digest,
          verifier: trustedVerifierFrom(response),
          checks: body.checks,
          actor: verificationActorFrom(response),
        },
      );
      const checks = dependencies.repositories.verifications.listChecks(
        organizationIdFrom(response),
        verification.id,
      );

      response.location(
        `/api/v1/verifications/${encodeURIComponent(verification.id)}`,
      );
      response.status(201).json(
        toVerificationWithChecks({
          ...verification,
          checks,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/verifications/:verificationId/checks",
    (request, response, next) => {
      try {
        const body = request.body as CreateVerificationCheckBody;
        const check =
          dependencies.services.verification.recordVerificationCheck({
            organizationId: organizationIdFrom(response),
            verificationId: request.params.verificationId ?? "",
            sequence: body.sequence,
            name: body.name,
            status: body.status,
            message: body.message,
            actor: verificationActorFrom(response),
          });
        response.status(201).json(toVerificationCheck(check));
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/verifications/:verificationId/complete",
    (request, response, next) => {
      try {
        const body = request.body as CompleteVerificationBody;
        const completion =
          dependencies.services.verification.completeVerification({
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
          });
        response.json(toVerificationCompletion(completion));
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
