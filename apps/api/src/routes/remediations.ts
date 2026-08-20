import { Router } from "express";
import {
  LOCAL_ORGANIZATION_ID,
  type ApiDependencies,
} from "../dependencies.js";
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

const LOCAL_ACTOR = {
  actorType: "local_user",
  actorId: "local-workspace",
} as const;

export function createRemediationsRouter(
  dependencies: ApiDependencies,
): Router {
  const router = Router();

  router.post("/remediations", (request, response, next) => {
    try {
      const body = request.body as CreateRemediationBody;
      const remediation = dependencies.services.remediation.startRemediation({
        organizationId: LOCAL_ORGANIZATION_ID,
        findingId: body.finding_id,
        owner: body.owner,
        summary: body.summary,
        reference: body.reference,
        actor: LOCAL_ACTOR,
      });

      response.location(
        `/api/v1/remediations/${encodeURIComponent(remediation.id)}`,
      );
      response.status(201).json(toRemediation(remediation));
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/remediations/:remediationId/complete",
    (request, response, next) => {
      try {
        const body = request.body as CompleteRemediationBody;
        const remediation =
          dependencies.services.remediation.completeRemediation({
            organizationId: LOCAL_ORGANIZATION_ID,
            remediationId: request.params.remediationId ?? "",
            summary: body.summary,
            reference: body.reference,
            actor: LOCAL_ACTOR,
          });
        response.json(toRemediation(remediation));
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
