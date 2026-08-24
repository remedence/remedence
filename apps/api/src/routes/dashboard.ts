import { Router } from "express";
import { organizationIdFrom } from "../authentication.js";
import type { ApiDependencies } from "../dependencies.js";
import { findingQueryFrom } from "./finding-query.js";
import { toDashboard } from "./http-shapes.js";

export function createDashboardRouter(dependencies: ApiDependencies): Router {
  const router = Router();

  router.get("/dashboard", async (request, response, next) => {
    try {
      const snapshot = await dependencies.services.dashboard.getDashboard(
        findingQueryFrom(request, organizationIdFrom(response)),
      );
      response.json(toDashboard(snapshot));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
