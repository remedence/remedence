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
      schema_version: 4,
    });
    expect(response.headers["x-request-id"]).toMatch(/^[A-Za-z0-9._-]{1,80}$/);
    expect(JSON.stringify(response.body)).not.toMatch(/[A-Z]:\\|\/home\//);
  });

  it("separates process liveness from database readiness", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "remedence-probes-"));
    temporaryDirectories.push(temporaryDirectory);
    const dependencies = createDependencies({
      databasePath: join(temporaryDirectory, "remedence.db"),
      referenceTime: "2026-08-20T12:00:00.000Z",
      log: () => undefined,
    });
    dependencySets.push(dependencies);
    const app = createApp(dependencies);

    const live = await request(app).get("/livez").expect(200);
    expect(live.body).toEqual({ status: "ok" });
    expect(live.headers["cache-control"]).toBe("no-store");

    const ready = await request(app).get("/readyz").expect(200);
    expect(ready.body).toEqual({
      status: "ok",
      database: "ready",
      schema_version: 4,
    });
    expect(ready.headers["cache-control"]).toBe("no-store");

    const authentication = await request(app)
      .get("/api/auth/remedence-status")
      .expect(200);
    expect(authentication.body).toEqual({
      mode: "local",
      authenticated: true,
      user: null,
    });
  });
});

describe("live SLA evaluation", () => {
  it("re-evaluates SLA breach state when the process clock advances", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "remedence-live-sla-"),
    );
    temporaryDirectories.push(temporaryDirectory);
    let now = "2026-08-20T12:00:00.000Z";
    const dependencies = createDependencies({
      databasePath: join(temporaryDirectory, "remedence.db"),
      clock: { now: () => now },
      workspaceMode: "demo",
      log: () => undefined,
    });
    dependencySets.push(dependencies);
    const app = createApp(dependencies);

    await request(app)
      .post("/api/v1/imports")
      .send({
        company_id: "company-juniper-ridge-dental",
        finding_key: "SEC-LIVE-SLA",
        title: "Live SLA clock regression",
        description: "SLA state must update without restarting the API.",
        source: "Task 18 review",
        severity: "High",
        owner: "L. Chen",
        asset_name: "Patient Portal API",
        detected_at: "2026-08-20T11:00:00.000Z",
        sla_due_at: "2026-08-20T12:30:00.000Z",
      })
      .expect(201);

    const before = await request(app)
      .get("/api/v1/findings")
      .query({ search: "SEC-LIVE-SLA" })
      .expect(200);
    expect(before.body.items[0].sla_breached).toBe(false);

    now = "2026-08-20T13:00:00.000Z";

    const after = await request(app)
      .get("/api/v1/findings")
      .query({ search: "SEC-LIVE-SLA" })
      .expect(200);
    expect(after.body.items[0].sla_breached).toBe(true);
  });
});
