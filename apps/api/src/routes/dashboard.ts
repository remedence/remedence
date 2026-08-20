import { Router } from "express";
import type { ApiDependencies } from "../dependencies.js";
import { findingQueryFrom } from "./finding-query.js";
import { toDashboard } from "./http-shapes.js";

export function createDashboardRouter(dependencies: ApiDependencies): Router {
  const router = Router();

  router.get("/dashboard", (request, response, next) => {
    try {
      const snapshot = dependencies.services.dashboard.getDashboard(
        findingQueryFrom(request),
      );
      response.json(toDashboard(snapshot));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
