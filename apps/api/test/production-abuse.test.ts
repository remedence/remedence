import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { entityTag } from "../src/entity-tag.js";
import {
  closeDependencies,
  createDependencies,
  type ApiDependencies,
} from "../src/dependencies.js";

interface Fixture {
  app: ReturnType<typeof createApp>;
  dependencies: ApiDependencies;
  temporaryDirectory: string;
}

let fixture: Fixture;

function validImport(findingKey = "SEC-ABUSE-1") {
  return {
    company_id: "company-juniper-ridge-dental",
    finding_key: findingKey,
    title: "Literal <script>alert('x')</script> & Unicode 雪",
    description:
      "Quotes: \"double\" and 'single'\nSecond line & literal <b>tag</b>.",
    source: "Task 17 abuse",
    severity: "High",
    owner: "O'Neil & QA",
    asset_name: "api雪<&>",
    detected_at: "2026-08-20T10:00:00.000Z",
    sla_due_at: "2026-08-27T10:00:00.000Z",
  };
}

async function expectHealthy(): Promise<void> {
  const response = await request(fixture.app).get("/healthz").expect(200);
  expect(response.body).toEqual({
    status: "ok",
    database: "ready",
    schema_version: 9,
  });
}

function expectSafeProblem(response: request.Response): void {
  expect(response.headers["content-type"]).toMatch(
    /^application\/problem\+json\b/,
  );
  const serialized = JSON.stringify(response.body);
  expect(serialized).not.toMatch(/<html/i);
  expect(serialized).not.toMatch(/node_modules|[A-Z]:\\|\/home\//i);
  expect(serialized).not.toMatch(
    /\b(?:select|insert|update|delete)\b.+\bfrom\b/i,
  );
  expect(serialized).not.toContain("stack");
  expect(serialized).not.toContain("token=");
}

function findingTag(id: string): string {
  const finding = fixture.dependencies.repositories.findings.getById(
    "org-harborline",
    id,
  );
  if (!finding) throw new Error(`Missing test finding ${id}.`);
  return entityTag("finding", id, finding.version);
}

function remediationTag(id: string): string {
  const remediation = fixture.dependencies.repositories.remediations.getById(
    "org-harborline",
    id,
  );
  if (!remediation) throw new Error(`Missing test remediation ${id}.`);
  return entityTag("remediation", id, remediation.version);
}

beforeEach(() => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "remedence-abuse-"));
  const webDirectory = join(temporaryDirectory, "web");
  mkdirSync(join(webDirectory, "assets"), { recursive: true });
  writeFileSync(
    join(webDirectory, "index.html"),
    "<!doctype html><html><body>TASK17_SPA_INDEX</body></html>",
  );
  writeFileSync(join(webDirectory, "assets", "app-HASH.js"), "asset-ok");
  writeFileSync(
    join(temporaryDirectory, "package.json"),
    '{"private_marker":"TASK17_PARENT_PACKAGE_SECRET"}',
  );
  writeFileSync(
    join(temporaryDirectory, ".env"),
    "TASK17_ENV_SECRET=must-not-leak",
  );
  writeFileSync(
    join(temporaryDirectory, "remedence.db"),
    "TASK17_SQLITE_SECRET",
  );

  const dependencies = createDependencies({
    databasePath: join(temporaryDirectory, "data", "remedence.db"),
    workspaceMode: "demo",
    log: () => undefined,
  });
  fixture = {
    app: createApp(dependencies, { webDirectory }),
    dependencies,
    temporaryDirectory,
  };
});

afterEach(() => {
  closeDependencies(fixture.dependencies);
  rmSync(fixture.temporaryDirectory, { recursive: true, force: true });
});

describe("Task 17 production abuse boundaries", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const)(
    "keeps unsupported %s API routes inside structured Problem responses",
    async (method) => {
      const response = await request(fixture.app)
        [method.toLowerCase() as "post"]("/api/v1/definitely-not-a-route")
        .set("Content-Type", "application/json")
        .send({ probe: true });

      expect(response.status).toBe(404);
      expectSafeProblem(response);
      expect(response.body).toMatchObject({
        status: 404,
        code: "NOT_FOUND",
      });
      await expectHealthy();
    },
  );

  it("does not disclose files outside the approved web build directory", async () => {
    const probes = [
      "/../package.json",
      "/%2e%2e/package.json",
      "/assets/../index.html",
      "/assets/%2e%2e/package.json",
      "/assets/%2e%2e/%2e%2e/package.json",
      "/data/remedence.db",
      "/remedence.db",
      "/.env",
      "/bun.lock",
      "/apps/api/src/server.ts",
    ];

    for (const path of probes) {
      const response = await request(fixture.app).get(path);
      const body = response.text ?? "";
      expect(body).not.toContain("TASK17_PARENT_PACKAGE_SECRET");
      expect(body).not.toContain("TASK17_ENV_SECRET");
      expect(body).not.toContain("TASK17_SQLITE_SECRET");
      expect(body).not.toContain("createApp(dependencies");
    }
    await expectHealthy();
  });

  it("returns bounded Problems for malformed, empty, non-JSON, oversized, and wrong-type bodies", async () => {
    const malformed = await request(fixture.app)
      .post("/api/v1/imports")
      .set("Content-Type", "application/json")
      .send('{"company_id":');
    expect(malformed.status).toBe(400);
    expectSafeProblem(malformed);

    const empty = await request(fixture.app)
      .post("/api/v1/imports")
      .set("Content-Type", "application/json")
      .send("");
    expect(empty.status).toBe(400);
    expectSafeProblem(empty);

    const nonJson = await request(fixture.app)
      .post("/api/v1/imports")
      .set("Content-Type", "text/plain")
      .send("not-json");
    expect(nonJson.status).toBe(400);
    expectSafeProblem(nonJson);

    const oversized = await request(fixture.app)
      .post("/api/v1/imports")
      .send({ ...validImport(), description: "x".repeat(256 * 1024) });
    expect(oversized.status).toBe(413);
    expectSafeProblem(oversized);

    const wrongType = await request(fixture.app)
      .post("/api/v1/imports")
      .send({ ...validImport(), title: 42 });
    expect(wrongType.status).toBe(400);
    expectSafeProblem(wrongType);

    const tooLong = await request(fixture.app)
      .post("/api/v1/imports")
      .send({ ...validImport(), title: "x".repeat(301) });
    expect(tooLong.status).toBe(400);
    expectSafeProblem(tooLong);

    await expectHealthy();
  });

  it("persists harmless hostile-looking text literally without corrupting the API", async () => {
    const imported = await request(fixture.app)
      .post("/api/v1/imports")
      .send(validImport("SEC-ABUSE-TEXT"))
      .expect(201);

    expect(imported.body.finding).toMatchObject({
      finding_key: "SEC-ABUSE-TEXT",
      title: "Literal <script>alert('x')</script> & Unicode 雪",
      description:
        "Quotes: \"double\" and 'single'\nSecond line & literal <b>tag</b>.",
      owner: "O'Neil & QA",
      asset_name: "api雪<&>",
    });

    const reread = await request(fixture.app)
      .get("/api/v1/findings/SEC-ABUSE-TEXT")
      .expect(200);
    expect(reread.body.finding.title).toBe(imported.body.finding.title);
    expect(reread.body.finding.description).toBe(
      imported.body.finding.description,
    );
    await expectHealthy();
  });

  it.each([
    "/api/v1/findings?state=DefinitelyNotAState",
    "/api/v1/findings?sort=sideways",
    "/api/v1/findings?cursor=invalid",
    "/api/v1/findings?cursor=%21",
    "/api/v1/findings?page_size=0",
    "/api/v1/findings?page_size=-1",
    "/api/v1/findings?page_size=101",
    `/api/v1/findings?cursor=${"a".repeat(1025)}`,
    "/api/v1/findings?state=High&state=Low",
  ])(
    "rejects invalid query probe %s without destabilizing the server",
    async (path) => {
      const response = await request(fixture.app).get(path);
      expect(response.status).toBe(400);
      expectSafeProblem(response);
      await expectHealthy();
    },
  );

  it("keeps repeated workflow operations authoritative", async () => {
    const imported = await request(fixture.app)
      .post("/api/v1/imports")
      .send(validImport("SEC-ABUSE-REPEAT"))
      .expect(201);
    const findingId = imported.body.finding.id as string;

    const duplicateImport = await request(fixture.app)
      .post("/api/v1/imports")
      .send(validImport("SEC-ABUSE-REPEAT"));
    expect(duplicateImport.status).toBe(409);
    expectSafeProblem(duplicateImport);

    const remediation = await request(fixture.app)
      .post("/api/v1/remediations")
      .set("if-match", findingTag(findingId))
      .send({
        finding_id: findingId,
        owner: "Task 17",
        summary: "Bounded repeat test",
        reference: "task17://repeat/remediation",
      })
      .expect(201);
    const remediationId = remediation.body.id as string;

    const secondStart = await request(fixture.app)
      .post("/api/v1/remediations")
      .set("if-match", findingTag(findingId))
      .send({
        finding_id: findingId,
        owner: "Task 17",
        summary: "Invalid second remediation",
        reference: "task17://repeat/remediation-duplicate",
      });
    expect(secondStart.status).toBe(409);
    expectSafeProblem(secondStart);

    await request(fixture.app)
      .post(`/api/v1/remediations/${remediationId}/complete`)
      .set("if-match", remediationTag(remediationId))
      .send({
        summary: "Ready for verification",
        reference: "task17://repeat/remediation-complete",
      })
      .expect(200);

    const duplicateCompletion = await request(fixture.app)
      .post(`/api/v1/remediations/${remediationId}/complete`)
      .set("if-match", remediationTag(remediationId))
      .send({
        summary: "Duplicate completion",
        reference: "task17://repeat/remediation-complete-again",
      });
    expect(duplicateCompletion.status).toBe(409);
    expectSafeProblem(duplicateCompletion);

    const detail = await request(fixture.app)
      .get("/api/v1/findings/SEC-ABUSE-REPEAT")
      .expect(200);
    expect(detail.body.finding.state).toBe("Awaiting verification");
    expect(detail.body.remediations).toHaveLength(1);
    await expectHealthy();
  });

  it("allows at most one of two identical bounded remediation completions to win", async () => {
    const imported = await request(fixture.app)
      .post("/api/v1/imports")
      .send(validImport("SEC-ABUSE-RACE"))
      .expect(201);
    const remediation = await request(fixture.app)
      .post("/api/v1/remediations")
      .set("if-match", findingTag(imported.body.finding.id))
      .send({
        finding_id: imported.body.finding.id,
        owner: "Task 17",
        summary: "Bounded concurrency test",
        reference: "task17://race/remediation",
      })
      .expect(201);

    const body = {
      summary: "Concurrent completion",
      reference: "task17://race/complete",
    };
    const currentTag = remediationTag(remediation.body.id);
    const responses = await Promise.all([
      request(fixture.app)
        .post(`/api/v1/remediations/${remediation.body.id}/complete`)
        .set("if-match", currentTag)
        .send(body),
      request(fixture.app)
        .post(`/api/v1/remediations/${remediation.body.id}/complete`)
        .set("if-match", currentTag)
        .send(body),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 412,
    ]);
    expectSafeProblem(responses.find((response) => response.status === 412)!);

    const detail = await request(fixture.app)
      .get("/api/v1/findings/SEC-ABUSE-RACE")
      .expect(200);
    expect(detail.body.finding.state).toBe("Awaiting verification");
    expect(detail.body.remediations).toHaveLength(1);
    await expectHealthy();
  });
});
