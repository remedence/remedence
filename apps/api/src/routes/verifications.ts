import type { VerificationCheck } from "@remedence/core";
import { Router } from "express";
import {
  LOCAL_ORGANIZATION_ID,
  type ApiDependencies,
} from "../dependencies.js";
import {
  toVerificationCheck,
  toVerificationCompletion,
  toVerificationWithChecks,
} from "./http-shapes.js";

interface CreateVerificationBody {
  finding_id: string;
  remediation_id: string;
  method: string;
  worker_name: string;
  scope: string;
  checks: string[];
}

interface CreateVerificationCheckBody {
  sequence: number;
  name: string;
  status: Exclude<VerificationCheck["status"], "Pending">;
  message: string;
}

interface CompleteVerificationEvidenceBody {
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

const LOCAL_ACTOR = {
  actorType: "local_user",
  actorId: "local-workspace",
} as const;

export function createVerificationsRouter(
  dependencies: ApiDependencies,
): Router {
  const router = Router();

  router.post("/verifications", (request, response, next) => {
    try {
      const body = request.body as CreateVerificationBody;
      const verification = dependencies.services.verification.startVerification(
        {
          organizationId: LOCAL_ORGANIZATION_ID,
          findingId: body.finding_id,
          remediationId: body.remediation_id,
          method: body.method,
          workerName: body.worker_name,
          scope: body.scope,
          checks: body.checks,
          actor: LOCAL_ACTOR,
        },
      );
      const checks = dependencies.repositories.verifications.listChecks(
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
            organizationId: LOCAL_ORGANIZATION_ID,
            verificationId: request.params.verificationId ?? "",
            sequence: body.sequence,
            name: body.name,
            status: body.status,
            message: body.message,
            actor: LOCAL_ACTOR,
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
            organizationId: LOCAL_ORGANIZATION_ID,
            verificationId: request.params.verificationId ?? "",
            result: body.result,
            summary: body.summary,
            evidence: (body.evidence ?? []).map((item) => ({
              kind: item.kind,
              label: item.label,
              sourceReference: item.source_reference,
              metadata: item.metadata,
            })),
            actor: LOCAL_ACTOR,
          });
        response.json(toVerificationCompletion(completion));
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
