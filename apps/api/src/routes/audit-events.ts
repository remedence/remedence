import type { AuditEventQuery } from "@remedence/core";
import { Router, type Request } from "express";
import {
  LOCAL_ORGANIZATION_ID,
  type ApiDependencies,
} from "../dependencies.js";
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

function auditQueryFrom(request: Request): AuditEventQuery {
  const query = queryRecord(request);
  const entityType = optionalString(query, "entity_type");
  const entityId = optionalString(query, "entity_id");
  const from = optionalString(query, "from");
  const to = optionalString(query, "to");

  return {
    organizationId: LOCAL_ORGANIZATION_ID,
    page: integerValue(query, "page", 1),
    pageSize: integerValue(query, "page_size", 25),
    ...(entityType !== undefined ? { entityType } : {}),
    ...(entityId !== undefined ? { entityId } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
  };
}

export function createAuditEventsRouter(dependencies: ApiDependencies): Router {
  const router = Router();

  router.get("/audit-events", (request, response, next) => {
    try {
      const page = dependencies.repositories.auditEvents.list(
        auditQueryFrom(request),
      );
      response.json(toAuditEventPage(page));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
