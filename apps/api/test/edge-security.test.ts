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

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "remedence-edge-"));
  temporaryDirectories.push(directory);
  const dependencies = createDependencies({
    databasePath: join(directory, "remedence.db"),
    referenceTime: "2026-08-20T12:00:00.000Z",
    workspaceMode: "demo",
    log: () => undefined,
  });
  dependencySets.push(dependencies);
  return dependencies;
}

afterEach(() => {
  for (const dependencies of dependencySets.splice(0)) {
    closeDependencies(dependencies);
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("local HTTP edge security", () => {
  it("sets browser isolation headers and prevents API caching", async () => {
    const response = await request(createApp(fixture()))
      .get("/api/v1/dashboard")
      .expect(200);

    expect(response.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(response.headers["cross-origin-resource-policy"]).toBe(
      "same-origin",
    );
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects cross-origin mutations before workflow code runs", async () => {
    const app = createApp(fixture());

    const rejected = await request(app)
      .post("/api/v1/reports")
      .set("Origin", "https://attacker.example")
      .set("Sec-Fetch-Site", "cross-site")
      .send({ company_id: "company-harborline", period_label: "August" })
      .expect(403);

    expect(rejected.body).toMatchObject({
      status: 403,
      code: "CROSS_ORIGIN_REQUEST_REJECTED",
    });
  });

  it("allows same-origin browser mutations and non-browser local clients", async () => {
    const app = createApp(fixture());
    const body = {
      company_id: "company-juniper-ridge-dental",
      finding_key: "SEC-EDGE-1",
      title: "Same-origin mutation",
      description: "Origin validation regression fixture.",
      source: "edge test",
      severity: "Low",
      owner: "Operator",
      asset_name: "Local host",
      detected_at: "2026-08-20T10:00:00.000Z",
      sla_due_at: "2026-08-21T10:00:00.000Z",
    };

    await request(app)
      .post("/api/v1/imports")
      .set("Host", "127.0.0.1:43180")
      .set("Origin", "http://127.0.0.1:43180")
      .send(body)
      .expect(201);

    await request(app)
      .post("/api/v1/imports")
      .send({ ...body, finding_key: "SEC-EDGE-2" })
      .expect(201);
  });

  it("allows only an explicitly configured loopback development proxy origin", async () => {
    const body = {
      company_id: "company-juniper-ridge-dental",
      finding_key: "SEC-DEV-PROXY",
      title: "Development proxy mutation",
      description: "Explicit local proxy origin regression fixture.",
      source: "edge test",
      severity: "Low",
      owner: "Operator",
      asset_name: "Local host",
      detected_at: "2026-08-20T10:00:00.000Z",
      sla_due_at: "2026-08-21T10:00:00.000Z",
    };
    const app = createApp(fixture(), {
      allowedMutationOrigins: ["http://127.0.0.1:5173"],
    });

    await request(app)
      .post("/api/v1/imports")
      .set("Origin", "http://127.0.0.1:5173")
      .set("Sec-Fetch-Site", "same-origin")
      .send(body)
      .expect(201);
    await request(app)
      .post("/api/v1/imports")
      .set("Origin", "http://127.0.0.1:5174")
      .send({ ...body, finding_key: "SEC-DEV-PROXY-REJECT" })
      .expect(403);
  });

  it("returns a safe retryable problem after the configured request budget", async () => {
    let now = 1_000;
    const app = createApp(fixture(), {
      rateLimit: { maxRequests: 2, windowMs: 10_000, now: () => now },
    });

    await request(app).get("/api/v1/dashboard").expect(200);
    const allowed = await request(app).get("/api/v1/dashboard").expect(200);
    expect(allowed.headers["ratelimit-remaining"]).toBe("0");

    const limited = await request(app).get("/api/v1/dashboard").expect(429);
    expect(limited.headers["retry-after"]).toBe("10");
    expect(limited.body).toMatchObject({
      status: 429,
      code: "RATE_LIMIT_EXCEEDED",
    });

    now = 11_000;
    await request(app).get("/api/v1/dashboard").expect(200);
  });
});
