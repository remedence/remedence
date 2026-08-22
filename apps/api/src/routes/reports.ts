import {
  DomainError,
  renderReportMarkdown,
  type Report,
} from "@remedence/core";
import { Router } from "express";
import {
  LOCAL_ORGANIZATION_ID,
  type ApiDependencies,
} from "../dependencies.js";
import { toReport } from "./http-shapes.js";

interface CreateReportBody {
  company_id: string;
  period_label: string;
}

const LOCAL_ACTOR = {
  actorType: "local_user",
  actorId: "local-workspace",
} as const;

function slugSegment(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "report";
}

function reportDownloadFilename(report: Report): string {
  return `${slugSegment(report.snapshot.companyName)}-${slugSegment(report.periodLabel)}-security-review.md`;
}

function requireReport(
  dependencies: ApiDependencies,
  reportId: string,
): Report {
  const report = dependencies.repositories.reports.getById(
    LOCAL_ORGANIZATION_ID,
    reportId,
  );
  if (!report) {
    throw new DomainError("REPORT_NOT_FOUND", 404, "Report was not found.");
  }
  return report;
}

export function createReportsRouter(dependencies: ApiDependencies): Router {
  const router = Router();

  router.post("/reports", (request, response, next) => {
    try {
      const body = request.body as CreateReportBody;
      const report = dependencies.services.reports.createReport({
        organizationId: LOCAL_ORGANIZATION_ID,
        companyId: body.company_id,
        periodLabel: body.period_label,
        actor: LOCAL_ACTOR,
      });

      response.location(`/api/v1/reports/${encodeURIComponent(report.id)}`);
      response.status(201).json(toReport(report));
    } catch (error) {
      next(error);
    }
  });

  router.get("/reports/:reportId", (request, response, next) => {
    try {
      const report = requireReport(dependencies, request.params.reportId ?? "");
      response.json(toReport(report));
    } catch (error) {
      next(error);
    }
  });

  router.get("/reports/:reportId/download", (request, response, next) => {
    try {
      const report = requireReport(dependencies, request.params.reportId ?? "");
      const filename = reportDownloadFilename(report);

      response.set("Content-Disposition", `attachment; filename="${filename}"`);
      response.type("text/markdown").send(renderReportMarkdown(report));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
