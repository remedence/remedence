import type { AuditEventQuery } from "@remedence/core";
import { Router, type Request } from "express";
import { organizationIdFrom } from "../authentication.js";
import { requirePrincipalRole } from "../authentication.js";
import type { ApiDependencies } from "../dependencies.js";
import { toAuditEventPage } from "./http-shapes.js";

function queryRecord(request: Request): Record<string, unknown> {
  return request.query as unknown as Record<string, unknown>;
}

function optionalString(
  query: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = query[name];
  return value === undefined ? undefined : String(value);
}

function integerValue(
  query: Record<string, unknown>,
  name: string,
  fallback: number,
): number {
  const value = query[name];
  if (value === undefined) return fallback;
  return typeof value === "number" ? value : Number(value);
}

function auditQueryFrom(
  request: Request,
  organizationId: string,
): AuditEventQuery {
  const query = queryRecord(request);
  const entityType = optionalString(query, "entity_type");
  const entityId = optionalString(query, "entity_id");
  const from = optionalString(query, "from");
  const to = optionalString(query, "to");
  const cursor = optionalString(query, "cursor");

  return {
    organizationId,
    ...(cursor ? { cursor } : {}),
    pageSize: integerValue(query, "page_size", 25),
    ...(entityType !== undefined ? { entityType } : {}),
    ...(entityId !== undefined ? { entityId } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
  };
}

export function createAuditEventsRouter(dependencies: ApiDependencies): Router {
  const router = Router();

  router.get(
    "/audit-events",
    requirePrincipalRole(["Owner", "Administrator"]),
    async (request, response, next) => {
      try {
        const page = await dependencies.repositories.auditEvents.list(
          auditQueryFrom(request, organizationIdFrom(response)),
        );
        response.json(toAuditEventPage(page));
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
