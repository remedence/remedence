import { DomainError } from "@remedence/core";
import { Router } from "express";
import {
  LOCAL_ORGANIZATION_ID,
  type ApiDependencies,
} from "../dependencies.js";
import { toCompany } from "./http-shapes.js";

export function createCompaniesRouter(dependencies: ApiDependencies): Router {
  const router = Router();

  router.get("/companies", (_request, response, next) => {
    try {
      const companies = dependencies.repositories.companies.list(
        LOCAL_ORGANIZATION_ID,
      );
      response.json(companies.map(toCompany));
    } catch (error) {
      next(error);
    }
  });

  router.get("/companies/:companyId", (request, response, next) => {
    try {
      const company = dependencies.repositories.companies.getById(
        LOCAL_ORGANIZATION_ID,
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
