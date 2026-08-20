import { DomainError } from "@remedence/core";
import { Router } from "express";
import {
  LOCAL_ORGANIZATION_ID,
  type ApiDependencies,
} from "../dependencies.js";
import { findingQueryFrom } from "./finding-query.js";
import { toFindingDetail, toFindingPage } from "./http-shapes.js";

export function createFindingsRouter(dependencies: ApiDependencies): Router {
  const router = Router();

  router.get("/findings", (request, response, next) => {
    try {
      const page = dependencies.repositories.findings.list(
        findingQueryFrom(request),
      );
      response.json(toFindingPage(page));
    } catch (error) {
      next(error);
    }
  });

  router.get("/findings/:findingId", (request, response, next) => {
    try {
      const detail = dependencies.repositories.findings.getDetail(
        LOCAL_ORGANIZATION_ID,
        request.params.findingId ?? "",
      );
      if (!detail) {
        throw new DomainError(
          "FINDING_NOT_FOUND",
          404,
          "Finding was not found.",
        );
      }
      response.json(toFindingDetail(detail));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
