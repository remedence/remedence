import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import * as OpenApiValidator from "express-openapi-validator";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import {
  DEFAULT_LOCAL_ORGANIZATION_ID,
  type ApiDependencies,
} from "./dependencies.js";
import {
  authenticatedPrincipalFrom,
  establishLocalPrincipal,
  requireAuthenticatedPrincipal,
  requirePrincipalRole,
} from "./authentication.js";
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
import { createOnboardingRouter } from "./routes/onboarding.js";
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
  if (dependencies.rateLimit) {
    app.use(
      createRateLimit(
        options.rateLimit ?? DEFAULT_RATE_LIMIT,
        dependencies.rateLimit,
        (request) => `edge:${request.socket.remoteAddress ?? "unknown"}`,
      ),
    );
  }
  app.get("/api/auth/remedence-status", async (request, response, next) => {
    try {
      if (!dependencies.authentication) {
        response.json({
          mode: "local",
          authenticated: true,
          user: null,
          mfa: { required: false, enrolled: false },
          password_reset_enabled: false,
          federation_protocols: [],
        });
        return;
      }
      const session = await dependencies.authentication.getSession(
        fromNodeHeaders(request.headers),
      );
      response.json({
        mode: "required",
        authenticated: session !== null,
        user: session
          ? {
              id: session.user.id,
              name: session.user.name,
              email: session.user.email,
            }
          : null,
        mfa: {
          required: dependencies.authentication.requireMfa,
          enrolled: session?.user.twoFactorEnabled === true,
        },
        password_reset_enabled:
          dependencies.authentication.passwordResetEnabled,
        federation_protocols: dependencies.authentication.federationProtocols,
      });
    } catch (error) {
      next(error);
    }
  });
  if (dependencies.authentication) {
    app.use(
      [
        "/api/auth/sso/register",
        "/api/auth/sso/update-provider",
        "/api/auth/sso/delete-provider",
      ],
      requireAuthenticatedPrincipal(dependencies.authentication),
      requirePrincipalRole(["Owner", "Administrator"]),
    );
    app.all("/api/auth/*splat", toNodeHandler(dependencies.authentication));
  }
  app.use(
    express.json({
      limit: "256kb",
      type: "application/json",
    }),
  );
  app.use(
    "/api/v1/evidence/artifacts",
    express.raw({ type: "application/octet-stream", limit: "25mb" }),
  );

  app.get("/livez", (_request, response) => {
    response.json({ status: "ok" });
  });

  const readinessHandler = (
    _request: express.Request,
    response: express.Response,
  ) => {
    const health = dependencies.health();
    response.status(health.database === "ready" ? 200 : 503).json({
      status: health.database === "ready" ? "ok" : "degraded",
      database: health.database,
      schema_version: health.schemaVersion,
    });
  };
  app.get("/readyz", readinessHandler);
  app.get("/healthz", readinessHandler);

  if (dependencies.authentication) {
    app.use(
      "/api/v1",
      requireAuthenticatedPrincipal(dependencies.authentication),
    );
  } else {
    app.use(
      "/api/v1",
      establishLocalPrincipal(
        () =>
          dependencies.workspace?.status().organization?.id ??
          dependencies.localOrganizationId ??
          DEFAULT_LOCAL_ORGANIZATION_ID,
      ),
    );
  }

  if (dependencies.rateLimit) {
    app.use(
      createRateLimit(
        options.rateLimit ?? DEFAULT_RATE_LIMIT,
        dependencies.rateLimit,
        (request, response) => {
          const principal = authenticatedPrincipalFrom(response);
          return principal
            ? `tenant:${principal.organizationId}`
            : `public:${request.socket.remoteAddress ?? "unknown"}`;
        },
      ),
    );
  }

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
  app.use("/api/v1", createOnboardingRouter(dependencies));
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
