import type { FindingQuery, FindingState, Severity } from "@remedence/core";
import type { Request } from "express";
import { LOCAL_ORGANIZATION_ID } from "../dependencies.js";

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

export function findingQueryFrom(request: Request): FindingQuery {
  const query = queryRecord(request);
  const search = optionalString(query, "search");
  const companyId = optionalString(query, "company_id");
  const state = optionalString(query, "state") as FindingState | undefined;
  const severity = optionalString(query, "severity") as Severity | undefined;
  const owner = optionalString(query, "owner");
  const sort = (optionalString(query, "sort") ??
    "priority") as FindingQuery["sort"];
  const includeVerifiedValue = query.include_verified;

  return {
    organizationId: LOCAL_ORGANIZATION_ID,
    sort,
    includeVerified:
      includeVerifiedValue === true || includeVerifiedValue === "true",
    page: integerValue(query, "page", 1),
    pageSize: integerValue(query, "page_size", 25),
    ...(search !== undefined ? { search } : {}),
    ...(companyId !== undefined ? { companyId } : {}),
    ...(state !== undefined ? { state } : {}),
    ...(severity !== undefined ? { severity } : {}),
    ...(owner !== undefined ? { owner } : {}),
  };
}
