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

let directory: string;
let dependencies: ApiDependencies;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "remedence-privacy-"));
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

describe("tenant privacy lifecycle", () => {
  it("exports tenant data and evidence bytes without authentication secrets", async () => {
    const app = createApp(dependencies);
    const bytes = Buffer.from("privacy export artifact");
    const artifact = await request(app)
      .post("/api/v1/evidence/artifacts")
      .set("content-type", "application/octet-stream")
      .set("x-evidence-filename", "privacy.txt")
      .send(bytes)
      .expect(201);

    const exported = await request(app)
      .get("/api/v1/privacy/export")
      .expect(200);
    expect(exported.headers["content-disposition"]).toContain(
      "remedence-org-harborline-export.json",
    );
    expect(exported.body.organization_id).toBe("org-harborline");
    expect(exported.body.records.organizations).toHaveLength(1);
    expect(exported.body.artifacts).toContainEqual({
      id: artifact.body.id,
      filename: "privacy.txt",
      content_hash: artifact.body.content_hash,
      bytes_base64: bytes.toString("base64"),
    });
    const serialized = JSON.stringify(exported.body);
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("credential_ciphertext");
  });

  it("blocks deletion under legal hold and completes confirmed offboarding", async () => {
    const app = createApp(dependencies);
    const artifact = await request(app)
      .post("/api/v1/evidence/artifacts")
      .set("content-type", "application/octet-stream")
      .set("x-evidence-filename", "held.txt")
      .send(Buffer.from("held artifact"))
      .expect(201);
    await request(app)
      .post(`/api/v1/privacy/artifacts/${artifact.body.id}/legal-hold`)
      .send({ legal_hold: true })
      .expect(200);
    await request(app)
      .post("/api/v1/privacy/delete-tenant")
      .send({ confirmation: "DELETE org-harborline" })
      .expect(409);
    await request(app)
      .post(`/api/v1/privacy/artifacts/${artifact.body.id}/legal-hold`)
      .send({ legal_hold: false })
      .expect(200);

    const deleted = await request(app)
      .post("/api/v1/privacy/delete-tenant")
      .send({ confirmation: "DELETE org-harborline" })
      .expect(200);
    expect(deleted.body).toMatchObject({
      organization_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      status: "Complete",
    });
    expect(dependencies.workspace.status().initialized).toBe(false);
    expect(dependencies.privacy.listPendingDeletionReceipts()).toEqual([]);
  });

  it("durably journals retention cleanup and exempts legal holds", async () => {
    const app = createApp(dependencies);
    const expired = await request(app)
      .post("/api/v1/evidence/artifacts")
      .set("content-type", "application/octet-stream")
      .set("x-evidence-filename", "expired.txt")
      .send(Buffer.from("expired artifact"))
      .expect(201);
    const held = await request(app)
      .post("/api/v1/evidence/artifacts")
      .set("content-type", "application/octet-stream")
      .set("x-evidence-filename", "held-retention.txt")
      .send(Buffer.from("held retention artifact"))
      .expect(201);
    await request(app)
      .post(`/api/v1/privacy/artifacts/${held.body.id}/legal-hold`)
      .send({ legal_hold: true })
      .expect(200);

    const receipt = dependencies.privacy.purgeExpiredUnadoptedArtifacts({
      receiptId: "retention-receipt",
      now: "2030-01-01T00:00:00.000Z",
    });
    expect(receipt?.objectKeys).toHaveLength(1);
    expect(
      dependencies.repositories.evidence.getArtifact(
        "org-harborline",
        expired.body.id,
      ),
    ).toBeUndefined();
    expect(
      dependencies.repositories.evidence.getArtifact(
        "org-harborline",
        held.body.id,
      ),
    ).toBeDefined();
    expect(dependencies.privacy.listPendingDeletionReceipts()).toHaveLength(1);
  });
});
