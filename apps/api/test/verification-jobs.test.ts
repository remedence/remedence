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
import { entityTag } from "../src/entity-tag.js";
import {
  signExecutionReceipt,
  VerificationWorker,
} from "@remedence/verification";
import { ApiVerificationWorkerSource } from "../src/verification-worker-source.js";

let directory: string;
let dependencies: ApiDependencies;

const profile = {
  id: "authorization-regression",
  image: `registry.example/remedence/verifier@sha256:${"a".repeat(64)}`,
  command: ["/opt/remedence/verify"],
  timeoutSeconds: 60,
  maxAttempts: 2,
  memoryMegabytes: 256,
  cpuCount: 1,
  network: "none" as const,
};
const receiptSigningKey = "worker-receipt-test-key-000000000000";

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "remedence-worker-api-"));
  dependencies = createDependencies({
    databasePath: join(directory, "remedence.db"),
    workspaceMode: "demo",
    verificationProfiles: [profile],
    log: () => undefined,
  });
});

afterEach(() => {
  closeDependencies(dependencies);
  rmSync(directory, { recursive: true, force: true });
});

describe("isolated verification jobs API", () => {
  it("binds a run to an approved profile and prevents operator result submission", async () => {
    const app = createApp(dependencies);
    const imported = await request(app)
      .post("/api/v1/imports")
      .send({
        company_id: "company-juniper-ridge-dental",
        finding_key: "SEC-WORKER-1",
        title: "Worker verification boundary",
        description: "Results must come from an isolated execution receipt.",
        source: "Worker test",
        severity: "High",
        owner: "Worker test",
        asset_name: "api",
        detected_at: "2026-08-23T10:00:00.000Z",
        sla_due_at: "2026-08-30T10:00:00.000Z",
      })
      .expect(201);
    const finding = imported.body.finding as { id: string; version: number };
    const remediation = await request(app)
      .post("/api/v1/remediations")
      .set("if-match", entityTag("finding", finding.id, finding.version))
      .send({
        finding_id: finding.id,
        owner: "Worker test",
        summary: "Patch ready for isolated execution.",
        reference: "test://worker/remediation",
      })
      .expect(201);
    await request(app)
      .post(`/api/v1/remediations/${remediation.body.id}/complete`)
      .set(
        "if-match",
        entityTag("remediation", remediation.body.id, remediation.body.version),
      )
      .send({
        summary: "Ready for worker.",
        reference: "test://worker/complete",
      })
      .expect(200);
    const detail = await request(app)
      .get("/api/v1/findings/SEC-WORKER-1")
      .expect(200);

    const started = await request(app)
      .post("/api/v1/verifications")
      .set(
        "if-match",
        entityTag("finding", finding.id, detail.body.finding.version),
      )
      .send({
        finding_id: finding.id,
        remediation_id: remediation.body.id,
        profile_id: profile.id,
        method: "Approved container profile",
        scope: "Authorization regression",
        source_revision: "commit-worker-1",
        patch_digest: "b".repeat(64),
        checks: ["Primary authorization path"],
      })
      .expect(201);

    expect(started.body.verification).toMatchObject({
      credential_type: "worker-profile",
      execution_source: "isolated-worker",
    });
    expect(started.body.job).toMatchObject({
      profile_id: profile.id,
      status: "Queued",
      attempt: 0,
      receipts: [],
    });
    const operatorResult = await request(app)
      .post(`/api/v1/verifications/${started.body.verification.id}/checks`)
      .set(
        "if-match",
        entityTag(
          "verification",
          started.body.verification.id,
          started.body.verification.version,
        ),
      )
      .send({
        sequence: 1,
        name: "Primary authorization path",
        status: "Passed",
        message: "Operator assertion must be rejected.",
      });
    expect(operatorResult.status).toBe(403);

    const profiles = await request(app)
      .get("/api/v1/verification-profiles")
      .expect(200);
    expect(profiles.body).toEqual([
      {
        id: profile.id,
        timeout_seconds: 60,
        max_attempts: 2,
        network: "none",
      },
    ]);
    expect(JSON.stringify(profiles.body)).not.toContain(profile.image);
    expect(JSON.stringify(profiles.body)).not.toContain(profile.command[0]);

    const cancelled = await request(app)
      .post(`/api/v1/verification-jobs/${started.body.job.id}/cancel`)
      .expect(200);
    expect(cancelled.body.status).toBe("Cancelled");
    const afterCancellation = await request(app)
      .get("/api/v1/findings/SEC-WORKER-1")
      .expect(200);
    expect(afterCancellation.body.finding.state).toBe("Awaiting verification");
    expect(
      afterCancellation.body.verifications.at(-1).verification,
    ).toMatchObject({
      status: "Cancelled",
      result_summary: "Cancelled by an administrator before execution.",
    });
  });

  it("atomically adopts sandbox checks, signed receipt evidence, and completion", async () => {
    const app = createApp(dependencies);
    const initial = await request(app)
      .get("/api/v1/findings/SEC-1042")
      .expect(200);
    const finding = initial.body.finding as { id: string; version: number };
    const remediation = await request(app)
      .post("/api/v1/remediations")
      .set("if-match", entityTag("finding", finding.id, finding.version))
      .send({
        finding_id: finding.id,
        owner: "Worker test",
        summary: "Second patch for worker execution.",
        reference: "test://worker/second-remediation",
      })
      .expect(201);
    await request(app)
      .post(`/api/v1/remediations/${remediation.body.id}/complete`)
      .set(
        "if-match",
        entityTag("remediation", remediation.body.id, remediation.body.version),
      )
      .send({
        summary: "Second patch ready.",
        reference: "test://worker/second-complete",
      })
      .expect(200);
    const awaiting = await request(app)
      .get("/api/v1/findings/SEC-1042")
      .expect(200);
    const started = await request(app)
      .post("/api/v1/verifications")
      .set(
        "if-match",
        entityTag("finding", finding.id, awaiting.body.finding.version),
      )
      .send({
        finding_id: finding.id,
        remediation_id: remediation.body.id,
        profile_id: profile.id,
        method: "Approved container profile",
        scope: "Authorization regression",
        source_revision: "commit-worker-2",
        patch_digest: "c".repeat(64),
        checks: ["Primary authorization path", "Regression suite"],
      })
      .expect(201);
    const jobId = started.body.job.id as string;
    const unsignedReceipt = {
      jobId,
      attempt: 1,
      workerId: "worker-one",
      profileId: profile.id,
      imageDigest: `sha256:${"a".repeat(64)}`,
      commandDigest: "d".repeat(64),
      startedAt: "2026-08-23T12:00:00.000Z",
      completedAt: "2026-08-23T12:00:05.000Z",
      exitCode: 0,
      timedOut: false,
      outputHash: "e".repeat(64),
    };
    const receipt = {
      ...unsignedReceipt,
      signature: signExecutionReceipt(unsignedReceipt, receiptSigningKey),
    };
    const worker = new VerificationWorker({
      workerId: "worker-one",
      queue: dependencies.verificationExecution!.queue,
      source: new ApiVerificationWorkerSource(dependencies, receiptSigningKey),
      sandbox: {
        async execute() {
          return {
            output: {
              result: "Passed",
              summary: "All isolated checks passed.",
              checks: [
                {
                  sequence: 1,
                  name: "Primary authorization path",
                  status: "Passed",
                  message: "Rejected as expected.",
                },
                {
                  sequence: 2,
                  name: "Regression suite",
                  status: "Passed",
                  message: "Regression suite passed.",
                },
              ],
            },
            receipt,
          };
        },
      },
    });

    expect(await worker.runOnce()).toBe(true);
    const job = await request(app)
      .get(`/api/v1/verification-jobs/${jobId}`)
      .expect(200);
    expect(job.body).toMatchObject({
      status: "Succeeded",
      attempt: 1,
      receipts: [
        {
          worker_id: "worker-one",
          signature: receipt.signature,
          output_hash: receipt.outputHash,
        },
      ],
    });
    const completed = await request(app)
      .get("/api/v1/findings/SEC-1042")
      .expect(200);
    expect(completed.body.finding.state).toBe("Verified fixed");
    const run = completed.body.verifications.find(
      (item: { verification: { id: string } }) =>
        item.verification.id === started.body.verification.id,
    );
    expect(run.checks.map((check: { status: string }) => check.status)).toEqual(
      ["Passed", "Passed"],
    );
    expect(
      completed.body.evidence.some(
        (item: { kind: string; attested_by: string }) =>
          item.kind === "worker-execution-receipt" &&
          item.attested_by === "worker-one",
      ),
    ).toBe(true);
  });
});
