import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  closeDependencies,
  createDependencies,
  type ApiDependencies,
} from "../src/dependencies.js";

const temporaryDirectories: string[] = [];
const dependencySets: ApiDependencies[] = [];

function fixture(workspaceMode: "empty" | "demo" = "empty") {
  const directory = mkdtempSync(join(tmpdir(), "remedence-onboarding-"));
  temporaryDirectories.push(directory);
  const dependencies = createDependencies({
    databasePath: join(directory, "remedence.db"),
    workspaceMode,
    log: () => undefined,
  });
  dependencySets.push(dependencies);
  return { app: createApp(dependencies), dependencies };
}

afterEach(() => {
  for (const dependencies of dependencySets.splice(0)) {
    closeDependencies(dependencies);
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("workspace onboarding", () => {
  it("starts empty and initializes a named workspace exactly once", async () => {
    const { app, dependencies } = fixture();

    expect(
      (await request(app).get("/api/v1/onboarding").expect(200)).body,
    ).toEqual({
      initialized: false,
      mode: null,
      organization: null,
    });
    expect(
      dependencies.repositories.companies.list("org-local-workspace"),
    ).toEqual([]);

    const initialized = await request(app)
      .post("/api/v1/onboarding")
      .send({
        mode: "empty",
        organization_name: "Northstar Security",
        organization_slug: "northstar-security",
      })
      .expect(201);
    expect(initialized.body).toEqual({
      initialized: true,
      mode: "empty",
      organization: {
        id: "org-local-workspace",
        name: "Northstar Security",
        slug: "northstar-security",
      },
    });

    const duplicate = await request(app)
      .post("/api/v1/onboarding")
      .send({ mode: "demo" })
      .expect(409);
    expect(duplicate.body.code).toBe("WORKSPACE_ALREADY_INITIALIZED");
  });

  it("installs Harborline data only after an explicit demo choice", async () => {
    const { app, dependencies } = fixture();

    const initialized = await request(app)
      .post("/api/v1/onboarding")
      .send({ mode: "demo" })
      .expect(201);
    expect(initialized.body).toMatchObject({
      initialized: true,
      mode: "demo",
      organization: { id: "org-harborline" },
    });
    expect(
      dependencies.repositories.companies.list("org-harborline"),
    ).toHaveLength(12);
  });
});
