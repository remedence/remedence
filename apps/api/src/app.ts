import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import * as OpenApiValidator from "express-openapi-validator";
import type { ApiDependencies } from "./dependencies.js";
import {
  createRateLimit,
  createSameOriginGuard,
  setSecurityHeaders,
  type RateLimitOptions,
} from "./middleware/edge-security.js";
import { problemHandler } from "./middleware/problem-handler.js";
import { createRequestContext } from "./middleware/request-context.js";
import { createAuditEventsRouter } from "./routes/audit-events.js";
import { createCompaniesRouter } from "./routes/companies.js";
import { createDashboardRouter } from "./routes/dashboard.js";
import { createEvidenceRouter } from "./routes/evidence.js";
import { createFindingsRouter } from "./routes/findings.js";
import { createImportsRouter } from "./routes/imports.js";
import { createRemediationsRouter } from "./routes/remediations.js";
import { createReportsRouter } from "./routes/reports.js";
import { createVerificationsRouter } from "./routes/verifications.js";

const openApiPath = fileURLToPath(
  new URL("../../../api/openapi.yaml", import.meta.url),
);

export interface AppOptions {
  webDirectory?: string;
  rateLimit?: RateLimitOptions;
  allowedMutationOrigins?: readonly string[];
}

const DEFAULT_RATE_LIMIT: RateLimitOptions = {
  maxRequests: 600,
  windowMs: 60_000,
};

function configureProductionWeb(app: Express, webDirectory: string): void {
  const assetsDirectory = join(webDirectory, "assets");
  const indexPath = join(webDirectory, "index.html");

  app.use(
    "/assets",
    express.static(assetsDirectory, {
      dotfiles: "deny",
      fallthrough: false,
      immutable: true,
      index: false,
      maxAge: "1y",
      redirect: false,
    }),
  );

  app.use(
    express.static(webDirectory, {
      dotfiles: "deny",
      fallthrough: true,
      index: false,
      maxAge: 0,
      redirect: false,
      setHeaders: (response) => {
        response.setHeader("Cache-Control", "no-cache");
      },
    }),
  );

  app.use((request, response, next) => {
    if (request.method !== "GET") {
      next();
      return;
    }
    response.setHeader("Cache-Control", "no-cache");
    response.sendFile(indexPath);
  });
}

export function createApp(
  dependencies: ApiDependencies,
  options: AppOptions = {},
): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);

  app.use(createRequestContext(dependencies.log));
  app.use(setSecurityHeaders);
  app.use(createSameOriginGuard(options.allowedMutationOrigins));
  app.use(createRateLimit(options.rateLimit ?? DEFAULT_RATE_LIMIT));
  app.use(
    express.json({
      limit: "256kb",
      type: "application/json",
    }),
  );

  app.get("/livez", (_request, response) => {
    response.json({ status: "ok" });
  });

  const readinessHandler = (
    _request: express.Request,
    response: express.Response,
  ) => {
    const health = dependencies.health();
    response.json({
      status: "ok",
      database: health.database,
      schema_version: health.schemaVersion,
    });
  };
  app.get("/readyz", readinessHandler);
  app.get("/healthz", readinessHandler);

  app.use(
    OpenApiValidator.middleware({
      apiSpec: openApiPath,
      validateRequests: true,
      validateResponses: true,
    }),
  );

  app.use("/api/v1", createDashboardRouter(dependencies));
  app.use("/api/v1", createAuditEventsRouter(dependencies));
  app.use("/api/v1", createCompaniesRouter(dependencies));
  app.use("/api/v1", createEvidenceRouter(dependencies));
  app.use("/api/v1", createFindingsRouter(dependencies));
  app.use("/api/v1", createImportsRouter(dependencies));
  app.use("/api/v1", createRemediationsRouter(dependencies));
  app.use("/api/v1", createReportsRouter(dependencies));
  app.use("/api/v1", createVerificationsRouter(dependencies));

  app.use("/api", (_request, _response, next) => {
    const error = Object.assign(new Error("API route not found."), {
      status: 404,
    });
    next(error);
  });

  if (options.webDirectory !== undefined) {
    configureProductionWeb(app, options.webDirectory);
  }

  app.use(problemHandler);
  return app;
}
