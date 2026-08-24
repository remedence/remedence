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

const dependenciesToClose: ApiDependencies[] = [];
const directories: string[] = [];

function importBody(findingKey = "SEC-IDEMPOTENT-1") {
  return {
    company_id: "company-juniper-ridge-dental",
    finding_key: findingKey,
    title: "Durable idempotency boundary",
    description: "The same committed mutation must replay without duplication.",
    source: "Idempotency test",
    severity: "High",
    owner: "Test operator",
    asset_name: "api",
    detected_at: "2026-08-23T10:00:00.000Z",
    sla_due_at: "2026-08-30T10:00:00.000Z",
  };
}

function openDependencies(databasePath: string): ApiDependencies {
  const dependencies = createDependencies({
    databasePath,
    workspaceMode: "demo",
    log: () => undefined,
  });
  dependenciesToClose.push(dependencies);
  return dependencies;
}

afterEach(() => {
  for (const dependencies of dependenciesToClose.splice(0)) {
    closeDependencies(dependencies);
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("durable API idempotency", () => {
  it("replays workspace initialization after organization identity changes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "remedence-idempotency-api-"));
    directories.push(directory);
    const dependencies = createDependencies({
      databasePath: join(directory, "remedence.db"),
      workspaceMode: "empty",
      log: () => undefined,
    });
    dependenciesToClose.push(dependencies);
    const app = createApp(dependencies);
    const key = "idempotency-workspace-bootstrap-1";

    const created = await request(app)
      .post("/api/v1/onboarding")
      .set("idempotency-key", key)
      .send({ mode: "demo" })
      .expect(201);
    const replay = await request(app)
      .post("/api/v1/onboarding")
      .set("idempotency-key", key)
      .send({ mode: "demo" })
      .expect(201);

    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.body).toEqual(created.body);
  });

  it("replays a committed import across dependency restarts without duplication", async () => {
    const directory = mkdtempSync(join(tmpdir(), "remedence-idempotency-api-"));
    directories.push(directory);
    const databasePath = join(directory, "remedence.db");
    const key = "idempotency-import-restart-1";
    const body = importBody();
    const firstDependencies = openDependencies(databasePath);

    const created = await request(createApp(firstDependencies))
      .post("/api/v1/imports")
      .set("idempotency-key", key)
      .send(body)
      .expect(201);
    expect(created.headers["idempotency-replayed"]).toBe("false");

    const replay = await request(createApp(firstDependencies))
      .post("/api/v1/imports")
      .set("idempotency-key", key)
      .send(body)
      .expect(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.headers.location).toBe(created.headers.location);
    expect(replay.body).toEqual(created.body);

    closeDependencies(firstDependencies);
    dependenciesToClose.splice(
      dependenciesToClose.indexOf(firstDependencies),
      1,
    );
    const secondDependencies = openDependencies(databasePath);
    const restartReplay = await request(createApp(secondDependencies))
      .post("/api/v1/imports")
      .set("idempotency-key", key)
      .send(body)
      .expect(201);
    expect(restartReplay.headers["idempotency-replayed"]).toBe("true");
    expect(restartReplay.body).toEqual(created.body);
    expect(
      secondDependencies.repositories.findings.findByKey(
        "org-harborline",
        body.finding_key,
      )?.id,
    ).toBe(created.body.finding.id);
  });

  it("rejects key reuse with a changed payload and preserves committed truth", async () => {
    const directory = mkdtempSync(join(tmpdir(), "remedence-idempotency-api-"));
    directories.push(directory);
    const dependencies = openDependencies(join(directory, "remedence.db"));
    const app = createApp(dependencies);
    const key = "idempotency-import-mismatch-1";

    await request(app)
      .post("/api/v1/imports")
      .set("idempotency-key", key)
      .send(importBody())
      .expect(201);
    const rejected = await request(app)
      .post("/api/v1/imports")
      .set("idempotency-key", key)
      .send(importBody("SEC-IDEMPOTENT-CHANGED"))
      .expect(409);
    expect(rejected.body.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(
      dependencies.repositories.findings.findByKey(
        "org-harborline",
        "SEC-IDEMPOTENT-CHANGED",
      ),
    ).toBeUndefined();
  });

  it("replays protected evidence uploads without creating another artifact", async () => {
    const directory = mkdtempSync(join(tmpdir(), "remedence-idempotency-api-"));
    directories.push(directory);
    const app = createApp(openDependencies(join(directory, "remedence.db")));
    const bytes = Buffer.from("independent verification output", "utf8");
    const key = "idempotency-evidence-upload-1";

    const created = await request(app)
      .post("/api/v1/evidence/artifacts")
      .set("content-type", "application/octet-stream")
      .set("x-evidence-filename", "verification.txt")
      .set("idempotency-key", key)
      .send(bytes)
      .expect(201);
    const replay = await request(app)
      .post("/api/v1/evidence/artifacts")
      .set("content-type", "application/octet-stream")
      .set("x-evidence-filename", "verification.txt")
      .set("idempotency-key", key)
      .send(bytes)
      .expect(201);

    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.body).toEqual(created.body);
  });

  it("does not retain failed validation attempts", async () => {
    const directory = mkdtempSync(join(tmpdir(), "remedence-idempotency-api-"));
    directories.push(directory);
    const app = createApp(openDependencies(join(directory, "remedence.db")));
    const key = "idempotency-corrected-retry-1";

    await request(app)
      .post("/api/v1/imports")
      .set("idempotency-key", key)
      .send({ ...importBody(), severity: "Impossible" })
      .expect(400);
    await request(app)
      .post("/api/v1/imports")
      .set("idempotency-key", key)
      .send(importBody())
      .expect(201);
  });

  it("rejects malformed idempotency keys before workflow execution", async () => {
    const directory = mkdtempSync(join(tmpdir(), "remedence-idempotency-api-"));
    directories.push(directory);
    const dependencies = openDependencies(join(directory, "remedence.db"));

    const rejected = await request(createApp(dependencies))
      .post("/api/v1/imports")
      .set("idempotency-key", "bad key")
      .send(importBody())
      .expect(400);
    expect(rejected.body.code).toBe("IDEMPOTENCY_KEY_INVALID");
    expect(
      dependencies.repositories.findings.findByKey(
        "org-harborline",
        "SEC-IDEMPOTENT-1",
      ),
    ).toBeUndefined();
  });
});
