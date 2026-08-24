import { Router } from "express";
import { mutationActorFrom, organizationIdFrom } from "../authentication.js";
import type { ApiDependencies } from "../dependencies.js";
import { requireIfMatch, setEntityTag } from "../entity-tag.js";
import { toRemediation } from "./http-shapes.js";

interface CreateRemediationBody {
  finding_id: string;
  owner: string;
  summary: string;
  reference: string;
}

interface CompleteRemediationBody {
  summary: string;
  reference: string;
}

export function createRemediationsRouter(
  dependencies: ApiDependencies,
): Router {
  const router = Router();

  router.post("/remediations", async (request, response, next) => {
    try {
      const body = request.body as CreateRemediationBody;
      const remediation =
        await dependencies.services.remediation.startRemediation({
          organizationId: organizationIdFrom(response),
          findingId: body.finding_id,
          owner: body.owner,
          summary: body.summary,
          reference: body.reference,
          actor: mutationActorFrom(response),
          expectedFindingVersion: requireIfMatch(
            request,
            "finding",
            body.finding_id,
          ),
        });

      response.location(
        `/api/v1/remediations/${encodeURIComponent(remediation.id)}`,
      );
      setEntityTag(
        response,
        "remediation",
        remediation.id,
        remediation.version,
      );
      response.status(201).json(toRemediation(remediation));
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/remediations/:remediationId/complete",
    async (request, response, next) => {
      try {
        const body = request.body as CompleteRemediationBody;
        const remediation =
          await dependencies.services.remediation.completeRemediation({
            organizationId: organizationIdFrom(response),
            remediationId: request.params.remediationId ?? "",
            summary: body.summary,
            reference: body.reference,
            actor: mutationActorFrom(response),
            expectedVersion: requireIfMatch(
              request,
              "remediation",
              request.params.remediationId ?? "",
            ),
          });
        setEntityTag(
          response,
          "remediation",
          remediation.id,
          remediation.version,
        );
        response.json(toRemediation(remediation));
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
