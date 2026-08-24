import { DomainError } from "@remedence/core";
import { Router } from "express";
import { organizationIdFrom } from "../authentication.js";
import type { ApiDependencies } from "../dependencies.js";
import { setEntityTag } from "../entity-tag.js";
import { findingQueryFrom } from "./finding-query.js";
import { toFindingDetail, toFindingPage } from "./http-shapes.js";

export function createFindingsRouter(dependencies: ApiDependencies): Router {
  const router = Router();

  router.get("/findings", async (request, response, next) => {
    try {
      const page = await dependencies.repositories.findings.list(
        findingQueryFrom(request, organizationIdFrom(response)),
      );
      response.json(toFindingPage(page));
    } catch (error) {
      next(error);
    }
  });

  router.get("/findings/:findingId", async (request, response, next) => {
    try {
      const detail = await dependencies.repositories.findings.getDetail(
        organizationIdFrom(response),
        request.params.findingId ?? "",
      );
      if (!detail) {
        throw new DomainError(
          "FINDING_NOT_FOUND",
          404,
          "Finding was not found.",
        );
      }
      setEntityTag(
        response,
        "finding",
        detail.finding.id,
        detail.finding.version,
      );
      response.json(
        await toFindingDetail(detail, (verificationId) =>
          dependencies.verificationExecution?.queue.getByVerification(
            detail.finding.organizationId,
            verificationId,
          ),
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  return router;
}
