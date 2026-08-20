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

afterEach(() => {
  for (const dependencies of dependencySets.splice(0)) {
    closeDependencies(dependencies);
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("GET /healthz", () => {
  it("returns database readiness without local paths", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "remedence-health-"));
    temporaryDirectories.push(temporaryDirectory);
    const dependencies = createDependencies({
      databasePath: join(temporaryDirectory, "remedence.db"),
      referenceTime: "2026-08-20T12:00:00.000Z",
      log: () => undefined,
    });
    dependencySets.push(dependencies);

    const response = await request(createApp(dependencies))
      .get("/healthz")
      .expect(200);

    expect(response.body).toEqual({
      status: "ok",
      database: "ready",
      schema_version: 1,
    });
    expect(response.headers["x-request-id"]).toMatch(/^[A-Za-z0-9._-]{1,80}$/);
    expect(JSON.stringify(response.body)).not.toMatch(/[A-Z]:\\|\/home\//);
  });
});
