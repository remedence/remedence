import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import * as OpenApiValidator from "express-openapi-validator";
import type { ApiDependencies } from "./dependencies.js";
import { problemHandler } from "./middleware/problem-handler.js";
import { createRequestContext } from "./middleware/request-context.js";
import { createCompaniesRouter } from "./routes/companies.js";
import { createDashboardRouter } from "./routes/dashboard.js";
import { createEvidenceRouter } from "./routes/evidence.js";
import { createFindingsRouter } from "./routes/findings.js";
import { createImportsRouter } from "./routes/imports.js";
import { createRemediationsRouter } from "./routes/remediations.js";
import { createVerificationsRouter } from "./routes/verifications.js";

const openApiPath = fileURLToPath(
  new URL("../../../api/openapi.yaml", import.meta.url),
);

export function createApp(dependencies: ApiDependencies): Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(createRequestContext(dependencies.log));
  app.use(
    express.json({
      limit: "256kb",
      type: "application/json",
    }),
  );

  app.get("/healthz", (_request, response) => {
    const health = dependencies.health();
    response.json({
      status: "ok",
      database: health.database,
      schema_version: health.schemaVersion,
    });
  });

  app.use(
    OpenApiValidator.middleware({
      apiSpec: openApiPath,
      validateRequests: true,
      validateResponses: true,
    }),
  );

  app.use("/api/v1", createDashboardRouter(dependencies));
  app.use("/api/v1", createCompaniesRouter(dependencies));
  app.use("/api/v1", createEvidenceRouter(dependencies));
  app.use("/api/v1", createFindingsRouter(dependencies));
  app.use("/api/v1", createImportsRouter(dependencies));
  app.use("/api/v1", createRemediationsRouter(dependencies));
  app.use("/api/v1", createVerificationsRouter(dependencies));

  app.use(problemHandler);
  return app;
}
