import { createHash, randomUUID } from "node:crypto";
import { DomainError } from "@remedence/core";
import type {
  IntegrationConnection,
  IntegrationDelivery,
  IntegrationProvider,
} from "@remedence/database";
import { Router } from "express";
import {
  authenticatedPrincipalFrom,
  organizationIdFrom,
} from "../authentication.js";
import type { ApiDependencies } from "../dependencies.js";
import { requireIfMatch, setEntityTag } from "../entity-tag.js";

interface CreateConnectionBody {
  provider: IntegrationProvider;
  name: string;
  configuration: Record<string, unknown>;
  credentials: Record<string, string>;
}

function requireAdministrator(
  response: Parameters<typeof authenticatedPrincipalFrom>[0],
) {
  const principal = authenticatedPrincipalFrom(response);
  if (!principal || !["Owner", "Administrator"].includes(principal.role)) {
    throw new DomainError(
      "INTEGRATION_ADMIN_REQUIRED",
      403,
      "Only an owner or administrator can manage integrations.",
    );
  }
  return principal;
}

function validateConnection(body: CreateConnectionBody): void {
  if (!body.name?.trim() || body.name.trim().length > 100) {
    throw new DomainError(
      "INVALID_INTEGRATION_NAME",
      400,
      "Integration name is required.",
    );
  }
  if (!body.configuration || !body.credentials) {
    throw new DomainError(
      "INVALID_INTEGRATION_CONFIGURATION",
      400,
      "Configuration and credentials are required.",
    );
  }
  if (body.provider === "generic-webhook") {
    const url = new URL(String(body.configuration.url ?? ""));
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new DomainError(
        "INVALID_INTEGRATION_URL",
        400,
        "Webhook URL must use HTTPS without embedded credentials.",
      );
    }
    if ((body.credentials.signing_secret ?? "").length < 32) {
      throw new DomainError(
        "WEAK_INTEGRATION_SECRET",
        400,
        "Webhook signing secret must contain at least 32 characters.",
      );
    }
    return;
  }
  if (body.provider === "github-issues") {
    if (
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(
        String(body.configuration.repository ?? ""),
      )
    ) {
      throw new DomainError(
        "INVALID_GITHUB_REPOSITORY",
        400,
        "GitHub repository must use owner/name form.",
      );
    }
    const apiBase = new URL(
      String(body.configuration.api_base ?? "https://api.github.com"),
    );
    if (apiBase.protocol !== "https:" || apiBase.username || apiBase.password) {
      throw new DomainError(
        "INVALID_INTEGRATION_URL",
        400,
        "GitHub API base must use HTTPS.",
      );
    }
    if ((body.credentials.token ?? "").length < 20) {
      throw new DomainError(
        "WEAK_INTEGRATION_SECRET",
        400,
        "GitHub token is required.",
      );
    }
    return;
  }
  if (body.provider === "scanner-webhook") {
    if ((body.credentials.webhook_secret ?? "").length < 32) {
      throw new DomainError(
        "WEAK_INTEGRATION_SECRET",
        400,
        "Scanner webhook secret must contain at least 32 characters.",
      );
    }
    return;
  }
  throw new DomainError(
    "UNSUPPORTED_INTEGRATION_PROVIDER",
    400,
    "Integration provider is unsupported.",
  );
}

function publicConnection(connection: IntegrationConnection) {
  return {
    id: connection.id,
    provider: connection.provider,
    name: connection.name,
    status: connection.status,
    configuration: connection.configuration,
    credentials_configured: true,
    version: connection.version,
    created_at: connection.createdAt,
    updated_at: connection.updatedAt,
  };
}

function publicDelivery(delivery: IntegrationDelivery) {
  return {
    id: delivery.id,
    connection_id: delivery.connectionId,
    event_key: delivery.eventKey,
    event_type: delivery.eventType,
    status: delivery.status,
    attempt: delivery.attempt,
    max_attempts: delivery.maxAttempts,
    available_at: delivery.availableAt,
    response_status: delivery.responseStatus,
    response_digest: delivery.responseDigest,
    last_error: delivery.lastError,
    created_at: delivery.createdAt,
    updated_at: delivery.updatedAt,
    completed_at: delivery.completedAt,
  };
}

export function createIntegrationsRouter(
  dependencies: ApiDependencies,
): Router {
  const router = Router();
  router.get("/webhooks", (_request, response) => {
    const organizationId = organizationIdFrom(response);
    response.json(
      dependencies.integrations.store
        .listConnections(organizationId)
        .filter((connection) => connection.provider === "scanner-webhook")
        .map((connection) => ({
          id: connection.id,
          status: connection.status,
          path: `/api/v1/integration-webhooks/${encodeURIComponent(organizationId)}/${encodeURIComponent(connection.id)}`,
        })),
    );
  });
  router.get("/integrations", (_request, response) => {
    response.json(
      dependencies.integrations.store
        .listConnections(organizationIdFrom(response))
        .map(publicConnection),
    );
  });
  router.post("/integrations", (request, response, next) => {
    try {
      requireAdministrator(response);
      const body = request.body as CreateConnectionBody;
      validateConnection(body);
      const now = dependencies.evidenceProtection.clock.now();
      const connection: IntegrationConnection = {
        organizationId: organizationIdFrom(response),
        id: dependencies.evidenceProtection.idGenerator.next(),
        provider: body.provider,
        name: body.name.trim(),
        status: "Active",
        configuration: body.configuration,
        credential: dependencies.integrations.credentials.protect(
          body.credentials,
        ),
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      dependencies.integrations.store.insertConnection(connection);
      setEntityTag(response, "integration", connection.id, connection.version);
      response.status(201).json(publicConnection(connection));
    } catch (error) {
      next(error);
    }
  });
  router.post(
    "/integrations/:connectionId/disable",
    (request, response, next) => {
      try {
        requireAdministrator(response);
        const organizationId = organizationIdFrom(response);
        const id = request.params.connectionId ?? "";
        const version = requireIfMatch(request, "integration", id);
        if (
          !dependencies.integrations.store.disableConnection(
            organizationId,
            id,
            version,
            dependencies.evidenceProtection.clock.now(),
          )
        ) {
          throw new DomainError(
            "CONCURRENT_STATE_CHANGE",
            412,
            "Integration changed or was not found.",
          );
        }
        const connection = dependencies.integrations.store.getConnection(
          organizationId,
          id,
        )!;
        setEntityTag(response, "integration", id, connection.version);
        response.json(publicConnection(connection));
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    "/integrations/:connectionId/deliveries",
    (request, response, next) => {
      try {
        requireAdministrator(response);
        const organizationId = organizationIdFrom(response);
        const connectionId = request.params.connectionId ?? "";
        const connection = dependencies.integrations.store.getConnection(
          organizationId,
          connectionId,
        );
        if (!connection || connection.status !== "Active")
          throw new DomainError(
            "INTEGRATION_NOT_ACTIVE",
            409,
            "Integration is unavailable or disabled.",
          );
        if (connection.provider === "scanner-webhook")
          throw new DomainError(
            "INTEGRATION_DIRECTION_INVALID",
            409,
            "Scanner webhook integrations accept inbound events only.",
          );
        const body = request.body as {
          event_key: string;
          event_type: string;
          payload: Record<string, unknown>;
          max_attempts?: number;
        };
        const now = dependencies.evidenceProtection.clock.now();
        const requestedDelivery: IntegrationDelivery = {
          organizationId,
          id: dependencies.evidenceProtection.idGenerator.next(),
          connectionId,
          eventKey: body.event_key,
          eventType: body.event_type,
          payload: body.payload,
          status: "Queued",
          attempt: 0,
          maxAttempts: body.max_attempts ?? 5,
          availableAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          responseStatus: null,
          responseDigest: null,
          lastError: "",
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        };
        const delivery =
          dependencies.integrations.store.enqueue(requestedDelivery);
        if (
          delivery.id !== requestedDelivery.id &&
          (delivery.eventType !== requestedDelivery.eventType ||
            JSON.stringify(delivery.payload) !==
              JSON.stringify(requestedDelivery.payload))
        ) {
          throw new DomainError(
            "INTEGRATION_EVENT_REPLAY_CONFLICT",
            409,
            "Event key was already used with a different delivery payload.",
          );
        }
        response.status(202).json(publicDelivery(delivery));
      } catch (error) {
        next(error);
      }
    },
  );
  router.get("/integrations/:connectionId/deliveries", (request, response) => {
    response.json(
      dependencies.integrations.store
        .listDeliveries(
          organizationIdFrom(response),
          request.params.connectionId ?? "",
        )
        .map(publicDelivery),
    );
  });
  router.post(
    "/integration-deliveries/:deliveryId/retry",
    (request, response, next) => {
      try {
        requireAdministrator(response);
        const organizationId = organizationIdFrom(response);
        const id = request.params.deliveryId ?? "";
        if (
          !dependencies.integrations.store.retryDeadLetter(
            organizationId,
            id,
            dependencies.evidenceProtection.clock.now(),
          )
        ) {
          throw new DomainError(
            "INTEGRATION_DELIVERY_NOT_RETRYABLE",
            409,
            "Only a dead-letter delivery can be retried.",
          );
        }
        response.json(
          publicDelivery(
            dependencies.integrations.store.getDelivery(organizationId, id)!,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );
  return router;
}

export function inboundPayloadDigest(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

export function fallbackEventKey(): string {
  return randomUUID();
}
