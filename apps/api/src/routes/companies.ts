import { DomainError } from "@remedence/core";
import { Router } from "express";
import { organizationIdFrom } from "../authentication.js";
import type { ApiDependencies } from "../dependencies.js";
import { toCompany } from "./http-shapes.js";

export function createCompaniesRouter(dependencies: ApiDependencies): Router {
  const router = Router();

  router.get("/companies", (_request, response, next) => {
    try {
      const companies = dependencies.repositories.companies.list(
        organizationIdFrom(response),
      );
      response.json(companies.map(toCompany));
    } catch (error) {
      next(error);
    }
  });

  router.get("/companies/:companyId", (request, response, next) => {
    try {
      const company = dependencies.repositories.companies.getById(
        organizationIdFrom(response),
        request.params.companyId ?? "",
      );
      if (!company) {
        throw new DomainError(
          "COMPANY_NOT_FOUND",
          404,
          "Company was not found.",
        );
      }
      response.json(toCompany(company));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
