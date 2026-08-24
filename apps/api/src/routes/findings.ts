import { DomainError } from "@remedence/core";
import { Router } from "express";
import { organizationIdFrom } from "../authentication.js";
import type { ApiDependencies } from "../dependencies.js";
import { setEntityTag } from "../entity-tag.js";
import { findingQueryFrom } from "./finding-query.js";
import { toFindingDetail, toFindingPage } from "./http-shapes.js";

export function createFindingsRouter(dependencies: ApiDependencies): Router {
  const router = Router();

  router.get("/findings", (request, response, next) => {
    try {
      const page = dependencies.repositories.findings.list(
        findingQueryFrom(request, organizationIdFrom(response)),
      );
      response.json(toFindingPage(page));
    } catch (error) {
      next(error);
    }
  });

  router.get("/findings/:findingId", (request, response, next) => {
    try {
      const detail = dependencies.repositories.findings.getDetail(
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
        toFindingDetail(detail, (verificationId) =>
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
