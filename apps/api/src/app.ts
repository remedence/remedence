import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import { DomainError, type Severity } from "@remedence/core";
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
import { createIdempotency } from "./middleware/idempotency.js";
import { createRequestContext } from "./middleware/request-context.js";
import { createAuditEventsRouter } from "./routes/audit-events.js";
import { createCompaniesRouter } from "./routes/companies.js";
import { createDashboardRouter } from "./routes/dashboard.js";
import { createEvidenceRouter } from "./routes/evidence.js";
import { createFindingsRouter } from "./routes/findings.js";
import { createImportsRouter } from "./routes/imports.js";
import { createIntegrationsRouter } from "./routes/integrations.js";
import { inboundPayloadDigest } from "./routes/integrations.js";
import { verifyInboundSignature } from "./integration-runtime.js";
import { toImportResult } from "./routes/http-shapes.js";
import { createOnboardingRouter } from "./routes/onboarding.js";
import { createPrivacyRouter } from "./routes/privacy.js";
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
  trustProxyHops?: number;
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
  app.set("trust proxy", options.trustProxyHops ?? false);

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
  app.post(
    "/api/v1/integration-webhooks/:organizationId/:connectionId",
    express.raw({ type: "application/json", limit: "256kb" }),
    (request, response, next) => {
      try {
        const organizationId = request.params.organizationId ?? "";
        const connectionId = request.params.connectionId ?? "";
        const eventKey = String(request.header("x-remedence-event-id") ?? "");
        const signature = String(request.header("x-remedence-signature") ?? "");
        const bodyBytes = Buffer.isBuffer(request.body)
          ? request.body
          : Buffer.alloc(0);
        const connection = dependencies.integrations.store.getConnection(
          organizationId,
          connectionId,
        );
        if (
          !connection ||
          connection.provider !== "scanner-webhook" ||
          connection.status !== "Active"
        ) {
          throw new DomainError(
            "INTEGRATION_WEBHOOK_NOT_FOUND",
            404,
            "Inbound integration webhook was not found.",
          );
        }
        if (!eventKey || eventKey.length > 200) {
          throw new DomainError(
            "INTEGRATION_EVENT_ID_REQUIRED",
            400,
            "A stable X-Remedence-Event-ID header is required.",
          );
        }
        const credential = dependencies.integrations.credentials.reveal(
          connection.credential,
        );
        if (
          !verifyInboundSignature(
            bodyBytes,
            signature,
            credential.webhook_secret ?? "",
          )
        ) {
          throw new DomainError(
            "INVALID_INTEGRATION_SIGNATURE",
            403,
            "Inbound integration signature is invalid.",
          );
        }
        const payload = JSON.parse(bodyBytes.toString("utf8")) as {
          company_id: string;
          finding_key: string;
          title: string;
          description: string;
          source: string;
          severity: Severity;
          owner: string;
          asset_name: string;
          detected_at: string;
          sla_due_at: string;
        };
        let duplicate = false;
        let result:
          | ReturnType<ApiDependencies["services"]["imports"]["importFinding"]>
          | undefined;
        const operation = () => {
          const reservation =
            dependencies.integrations.store.reserveInboundEvent({
              organizationId,
              connectionId,
              eventKey,
              payloadDigest: inboundPayloadDigest(bodyBytes),
              receivedAt: dependencies.evidenceProtection.clock.now(),
            });
          if (reservation === "conflict") {
            throw new DomainError(
              "INTEGRATION_EVENT_REPLAY_CONFLICT",
              409,
              "Event ID was already used with a different payload.",
            );
          }
          if (reservation === "duplicate") {
            duplicate = true;
            return;
          }
          result = dependencies.services.imports.importFinding({
            organizationId,
            companyId: payload.company_id,
            findingKey: payload.finding_key,
            title: payload.title,
            description: payload.description,
            source: payload.source,
            severity: payload.severity,
            owner: payload.owner,
            assetName: payload.asset_name,
            detectedAt: payload.detected_at,
            slaDueAt: payload.sla_due_at,
            actor: {
              actorType: "local_worker",
              actorId: `integration:${connection.id}`,
            },
          });
        };
        if (dependencies.runAtomically) {
          dependencies.runAtomically(operation);
        } else {
          operation();
        }
        if (duplicate) {
          response.setHeader("Idempotency-Replayed", "true");
          response.status(200).json({ status: "duplicate" });
          return;
        }
        response.status(201).json(toImportResult(result!));
      } catch (error) {
        next(error);
      }
    },
  );
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

  if (dependencies.idempotency) {
    app.use(
      "/api/v1",
      createIdempotency(
        dependencies.idempotency,
        dependencies.evidenceProtection.clock.now,
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
  app.use("/api/v1", createIntegrationsRouter(dependencies));
  app.use("/api/v1", createOnboardingRouter(dependencies));
  app.use("/api/v1", createPrivacyRouter(dependencies));
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
