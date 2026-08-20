import type { Severity } from "@remedence/core";
import { Router } from "express";
import {
  LOCAL_ORGANIZATION_ID,
  type ApiDependencies,
} from "../dependencies.js";
import { toImportResult } from "./http-shapes.js";

interface CreateImportBody {
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
}

const LOCAL_ACTOR = {
  actorType: "local_user",
  actorId: "local-workspace",
} as const;

export function createImportsRouter(dependencies: ApiDependencies): Router {
  const router = Router();

  router.post("/imports", (request, response, next) => {
    try {
      const body = request.body as CreateImportBody;
      const result = dependencies.services.imports.importFinding({
        organizationId: LOCAL_ORGANIZATION_ID,
        companyId: body.company_id,
        findingKey: body.finding_key,
        title: body.title,
        description: body.description,
        source: body.source,
        severity: body.severity,
        owner: body.owner,
        assetName: body.asset_name,
        detectedAt: body.detected_at,
        slaDueAt: body.sla_due_at,
        actor: LOCAL_ACTOR,
      });

      response.location(
        `/api/v1/findings/${encodeURIComponent(result.finding.findingKey)}`,
      );
      response.status(201).json(toImportResult(result));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
