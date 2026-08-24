import { DomainError, type EvidenceQuery } from "@remedence/core";
import { Router, type Request } from "express";
import { organizationIdFrom } from "../authentication.js";
import type { ApiDependencies } from "../dependencies.js";
import { toEvidence } from "./http-shapes.js";

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

function optionalBoolean(
  query: Record<string, unknown>,
  name: string,
): boolean | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  return value === true || value === "true";
}

function evidenceQueryFrom(
  request: Request,
  organizationId: string,
): EvidenceQuery {
  const query = queryRecord(request);
  const findingId = optionalString(query, "finding_id");
  const verificationId = optionalString(query, "verification_id");
  const locked = optionalBoolean(query, "locked");

  return {
    organizationId,
    ...(findingId !== undefined ? { findingId } : {}),
    ...(verificationId !== undefined ? { verificationId } : {}),
    ...(locked !== undefined ? { locked } : {}),
  };
}

export function createEvidenceRouter(dependencies: ApiDependencies): Router {
  const router = Router();

  router.get("/evidence", (request, response, next) => {
    try {
      const evidence = dependencies.repositories.evidence.list(
        evidenceQueryFrom(request, organizationIdFrom(response)),
      );
      response.json(evidence.map(toEvidence));
    } catch (error) {
      next(error);
    }
  });

  router.get("/evidence/:evidenceId", (request, response, next) => {
    try {
      const evidence = dependencies.repositories.evidence.getById(
        organizationIdFrom(response),
        request.params.evidenceId ?? "",
      );
      if (!evidence) {
        throw new DomainError(
          "EVIDENCE_NOT_FOUND",
          404,
          "Evidence was not found.",
        );
      }
      response.json(toEvidence(evidence));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
