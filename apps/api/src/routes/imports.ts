import type { Severity } from "@remedence/core";
import { Router } from "express";
import {
  LOCAL_ORGANIZATION_ID,
  type ApiDependencies,
} from "../dependencies.js";
import { mutationActorFrom } from "../authentication.js";
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
        actor: mutationActorFrom(response),
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
