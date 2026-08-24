import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  closeDependencies,
  createDependencies,
  type ApiDependencies,
} from "../src/dependencies.js";
import {
  IntegrationDeliveryWorker,
  IntegrationDispatcher,
} from "../src/integration-runtime.js";

let directory: string;
let dependencies: ApiDependencies;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "remedence-integrations-"));
  dependencies = createDependencies({
    databasePath: join(directory, "remedence.db"),
    workspaceMode: "demo",
    log: () => undefined,
  });
});

afterEach(() => {
  closeDependencies(dependencies);
  rmSync(directory, { recursive: true, force: true });
});

describe("managed integrations", () => {
  it("encrypts credentials, deduplicates queue events, and records provider receipts", async () => {
    const app = createApp(dependencies);
    const signingSecret = "webhook-signing-secret-0000000000000000";
    const created = await request(app)
      .post("/api/v1/integrations")
      .send({
        provider: "generic-webhook",
        name: "Customer webhook",
        configuration: { url: "https://hooks.example/remedence" },
        credentials: {
          signing_secret: signingSecret,
          bearer_token: "customer-token-value",
        },
      })
      .expect(201);
    expect(created.body).not.toHaveProperty("credentials");
    const stored = dependencies.integrations.store.getConnection(
      "org-harborline",
      created.body.id,
    )!;
    expect(stored.credential.ciphertext).not.toContain(signingSecret);
    expect(
      dependencies.integrations.credentials.reveal(stored.credential),
    ).toEqual({
      signing_secret: signingSecret,
      bearer_token: "customer-token-value",
    });

    const payload = { finding_key: "SEC-DELIVERY-1", state: "Verified fixed" };
    const queued = await request(app)
      .post(`/api/v1/integrations/${created.body.id}/deliveries`)
      .send({ event_key: "finding:1", event_type: "finding.verified", payload })
      .expect(202);
    const duplicate = await request(app)
      .post(`/api/v1/integrations/${created.body.id}/deliveries`)
      .send({ event_key: "finding:1", event_type: "finding.verified", payload })
      .expect(202);
    expect(duplicate.body.id).toBe(queued.body.id);
    await request(app)
      .post(`/api/v1/integrations/${created.body.id}/deliveries`)
      .send({
        event_key: "finding:1",
        event_type: "finding.verified",
        payload: { ...payload, state: "Needs remediation" },
      })
      .expect(409);

    let observed:
      { url: string; authorization: string; signature: string } | undefined;
    const worker = new IntegrationDeliveryWorker(
      dependencies.integrations.store,
      new IntegrationDispatcher(
        dependencies.integrations.credentials,
        async (input, init) => {
          const headers = init?.headers as Record<string, string> | undefined;
          observed = {
            url: String(input),
            authorization: String(headers?.authorization),
            signature: String(headers?.["x-remedence-signature"]),
          };
          return new Response("accepted", { status: 202 });
        },
      ),
      "integration-worker-test",
    );
    expect(await worker.runOnce()).toBe(true);
    expect(observed).toMatchObject({
      url: "https://hooks.example/remedence",
      authorization: "Bearer customer-token-value",
    });
    expect(observed?.signature).toBe(
      `sha256=${createHmac("sha256", signingSecret).update(JSON.stringify(payload)).digest("hex")}`,
    );
    const deliveries = await request(app)
      .get(`/api/v1/integrations/${created.body.id}/deliveries`)
      .expect(200);
    expect(deliveries.body[0]).toMatchObject({
      status: "Succeeded",
      attempt: 1,
      response_status: 202,
      response_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("validates signed scanner webhooks and rejects replay conflicts", async () => {
    const app = createApp(dependencies);
    const secret = "scanner-webhook-secret-00000000000000000";
    const created = await request(app)
      .post("/api/v1/integrations")
      .send({
        provider: "scanner-webhook",
        name: "Scanner intake",
        configuration: {},
        credentials: { webhook_secret: secret },
      })
      .expect(201);
    const payload = {
      company_id: "company-juniper-ridge-dental",
      finding_key: "SEC-SCANNER-1",
      title: "Scanner webhook finding",
      description: "Imported only after signature verification.",
      source: "Scanner webhook",
      severity: "High",
      owner: "Security",
      asset_name: "api",
      detected_at: "2026-08-23T12:00:00.000Z",
      sla_due_at: "2026-08-30T12:00:00.000Z",
    };
    const body = JSON.stringify(payload);
    const path = `/api/v1/integration-webhooks/org-harborline/${created.body.id}`;
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

    await request(app)
      .post(path)
      .set("content-type", "application/json")
      .set("x-remedence-event-id", "scanner-event-1")
      .set("x-remedence-signature", "sha256=" + "0".repeat(64))
      .send(body)
      .expect(403);
    await request(app)
      .post(path)
      .set("content-type", "application/json")
      .set("x-remedence-event-id", "scanner-event-1")
      .set("x-remedence-signature", signature)
      .send(body)
      .expect(201);
    const duplicate = await request(app)
      .post(path)
      .set("content-type", "application/json")
      .set("x-remedence-event-id", "scanner-event-1")
      .set("x-remedence-signature", signature)
      .send(body)
      .expect(200);
    expect(duplicate.headers["idempotency-replayed"]).toBe("true");

    const changedBody = JSON.stringify({ ...payload, title: "Changed replay" });
    await request(app)
      .post(path)
      .set("content-type", "application/json")
      .set("x-remedence-event-id", "scanner-event-1")
      .set(
        "x-remedence-signature",
        `sha256=${createHmac("sha256", secret).update(changedBody).digest("hex")}`,
      )
      .send(changedBody)
      .expect(409);
  });

  it("uses the GitHub provider and permits explicit dead-letter retry", async () => {
    const app = createApp(dependencies);
    const created = await request(app)
      .post("/api/v1/integrations")
      .send({
        provider: "github-issues",
        name: "Security issues",
        configuration: { repository: "remedence/security" },
        credentials: { token: "github-token-for-testing-only" },
      })
      .expect(201);
    const queued = await request(app)
      .post(`/api/v1/integrations/${created.body.id}/deliveries`)
      .send({
        event_key: "finding:github-1",
        event_type: "finding.created",
        payload: { title: "Security finding", body: "Review in Remedence." },
        max_attempts: 1,
      })
      .expect(202);
    let requestedUrl = "";
    let authorization = "";
    const worker = new IntegrationDeliveryWorker(
      dependencies.integrations.store,
      new IntegrationDispatcher(
        dependencies.integrations.credentials,
        async (input, init) => {
          requestedUrl = String(input);
          const headers = init?.headers as Record<string, string> | undefined;
          authorization = String(headers?.authorization);
          return new Response("provider unavailable", { status: 503 });
        },
      ),
      "github-worker-test",
    );
    expect(await worker.runOnce()).toBe(true);
    expect(requestedUrl).toBe(
      "https://api.github.com/repos/remedence/security/issues",
    );
    expect(authorization).toBe("Bearer github-token-for-testing-only");
    expect(
      dependencies.integrations.store.getDelivery(
        "org-harborline",
        queued.body.id,
      ),
    ).toMatchObject({ status: "Dead letter", attempt: 1, responseStatus: 503 });

    const retried = await request(app)
      .post(`/api/v1/integration-deliveries/${queued.body.id}/retry`)
      .expect(200);
    expect(retried.body).toMatchObject({ status: "Queued", attempt: 0 });
  });
});
