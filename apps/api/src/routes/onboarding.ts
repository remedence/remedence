import { DomainError } from "@remedence/core";
import { Router } from "express";
import { authenticatedPrincipalFrom } from "../authentication.js";
import type { ApiDependencies } from "../dependencies.js";

interface InitializeWorkspaceBody {
  mode: "empty" | "demo";
  organization_name?: string;
  organization_slug?: string;
}

export function createOnboardingRouter(dependencies: ApiDependencies): Router {
  const router = Router();

  router.get("/onboarding", async (_request, response) => {
    response.json(await dependencies.workspace.status());
  });

  router.post("/onboarding", async (request, response, next) => {
    try {
      const principal = authenticatedPrincipalFrom(response);
      if (!principal || principal.role !== "Owner") {
        throw new DomainError(
          "OWNER_REQUIRED",
          403,
          "Only an owner can initialize a workspace.",
        );
      }
      if ((await dependencies.workspace.status()).initialized) {
        throw new DomainError(
          "WORKSPACE_ALREADY_INITIALIZED",
          409,
          "Workspace is already initialized.",
        );
      }

      const body = request.body as InitializeWorkspaceBody;
      if (
        body.mode === "empty" &&
        (!body.organization_name?.trim() ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
            body.organization_slug?.trim().toLocaleLowerCase("en-US") ?? "",
          ))
      ) {
        throw new DomainError(
          "INVALID_WORKSPACE",
          400,
          "A workspace name and URL-safe slug are required.",
        );
      }

      const organization = await dependencies.workspace.initialize({
        mode: body.mode,
        ...(body.organization_name !== undefined
          ? { organizationName: body.organization_name }
          : {}),
        ...(body.organization_slug !== undefined
          ? { organizationSlug: body.organization_slug }
          : {}),
      });
      response.status(201).json({
        initialized: true,
        mode: body.mode,
        organization,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
