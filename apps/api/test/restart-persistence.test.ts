import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const serverPath = join(repositoryRoot, "apps", "api", "dist", "server.js");
const bunCli = process.env.npm_execpath;
const temporaryDirectories: string[] = [];
const childProcesses: ChildProcess[] = [];

beforeAll(() => {
  if (!bunCli) {
    throw new Error("Bun is required for restart persistence tests.");
  }
  execFileSync(bunCli, ["run", "--filter", "@remedence/api", "build"], {
    cwd: repositoryRoot,
    stdio: "pipe",
  });
});

async function reserveEphemeralPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Could not reserve an ephemeral loopback port.");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitForHealth(
  baseUrl: string,
  child: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `API process exited before health with code ${child.exitCode} signal ${child.signalCode}.`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`API did not become healthy: ${String(lastError)}`);
}

async function assertPortReleased(port: number): Promise<void> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", resolve);
  });
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });
}

function startApi(port: number, dataDirectory: string): ChildProcess {
  const child = spawn(process.execPath, [serverPath], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      REMEDENCE_API_PORT: String(port),
      REMEDENCE_DATA_DIR: dataDirectory,
      REMEDENCE_WORKSPACE_MODE: "demo",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  childProcesses.push(child);
  return child;
}

async function stopApi(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for API process shutdown.")),
      8_000,
    );
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  child.kill("SIGTERM");
  await exited;
}

async function jsonRequest<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<{ response: Response; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });
  const body = (await response.json()) as T;
  return { response, body };
}

afterEach(async () => {
  for (const child of childProcesses.splice(0)) {
    try {
      await stopApi(child);
    } catch {
      if (child.pid !== undefined && child.exitCode === null)
        child.kill("SIGKILL");
    }
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Task 17 restart persistence", () => {
  it("preserves imported truth and failed verification history across a different API process", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "remedence-restart-"));
    temporaryDirectories.push(dataDirectory);
    const port = await reserveEphemeralPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const suffix = Date.now().toString(36).toUpperCase();
    const findingKey = `SEC-RESTART-${suffix}`;

    const processA = startApi(port, dataDirectory);
    await waitForHealth(baseUrl, processA);

    const healthA = await jsonRequest<{
      status: string;
      database: string;
      schema_version: number;
    }>(baseUrl, "/healthz");
    expect(healthA.response.status).toBe(200);
    expect(healthA.body.schema_version).toBe(7);

    const imported = await jsonRequest<{
      finding: { id: string; finding_key: string; state: string };
    }>(baseUrl, "/api/v1/imports", {
      method: "POST",
      body: JSON.stringify({
        company_id: "company-juniper-ridge-dental",
        finding_key: findingKey,
        title: `Restart persistence ${suffix}`,
        description: "Persisted across separate API processes.",
        source: "Task 17 restart",
        severity: "High",
        owner: "Task 17",
        asset_name: "restart-api",
        detected_at: "2026-08-20T10:00:00.000Z",
        sla_due_at: "2026-08-27T10:00:00.000Z",
      }),
    });
    expect(imported.response.status).toBe(201);
    expect(imported.body.finding.finding_key).toBe(findingKey);
    const findingId = imported.body.finding.id;

    const remediation = await jsonRequest<{ id: string; status: string }>(
      baseUrl,
      "/api/v1/remediations",
      {
        method: "POST",
        body: JSON.stringify({
          finding_id: findingId,
          owner: "Task 17",
          summary: "First remediation before restart",
          reference: `task17://restart/${suffix}/remediation`,
        }),
      },
    );
    expect(remediation.response.status).toBe(201);

    const completedRemediation = await jsonRequest<{ status: string }>(
      baseUrl,
      `/api/v1/remediations/${remediation.body.id}/complete`,
      {
        method: "POST",
        body: JSON.stringify({
          summary: "Ready for independent restart verification",
          reference: `task17://restart/${suffix}/remediation-complete`,
        }),
      },
    );
    expect(completedRemediation.response.status).toBe(200);

    const verification = await jsonRequest<{
      verification: { id: string; status: string };
      checks: Array<{ sequence: number }>;
    }>(baseUrl, "/api/v1/verifications", {
      method: "POST",
      body: JSON.stringify({
        finding_id: findingId,
        remediation_id: remediation.body.id,
        method: "Restart regression",
        scope: "Persistence boundary",
        source_revision: `commit-${suffix}`,
        patch_digest: "a".repeat(64),
        checks: ["Restart persistence check"],
      }),
    });
    expect(verification.response.status).toBe(201);

    const check = await jsonRequest<{ status: string }>(
      baseUrl,
      `/api/v1/verifications/${verification.body.verification.id}/checks`,
      {
        method: "POST",
        body: JSON.stringify({
          sequence: 1,
          name: "Restart persistence check",
          status: "Failed",
          message: "Intentional Task 17 failed verification before restart.",
        }),
      },
    );
    expect(check.response.status).toBe(201);

    const failed = await jsonRequest<{
      verification: { status: string; result_summary: string };
      finding: { state: string };
    }>(
      baseUrl,
      `/api/v1/verifications/${verification.body.verification.id}/complete`,
      {
        method: "POST",
        body: JSON.stringify({
          result: "Failed",
          summary: "Intentional failure must survive restart.",
          evidence: [],
        }),
      },
    );
    expect(failed.response.status).toBe(200);
    expect(failed.body.finding.state).toBe("Verification failed");

    const beforeRestart = await jsonRequest<{
      finding: { id: string; finding_key: string; state: string };
      remediations: Array<{ id: string }>;
      verifications: Array<{
        verification: { id: string; status: string; result_summary: string };
        checks: Array<{ status: string; message: string }>;
      }>;
    }>(baseUrl, `/api/v1/findings/${encodeURIComponent(findingKey)}`);
    expect(beforeRestart.response.status).toBe(200);
    expect(beforeRestart.body.finding.state).toBe("Verification failed");

    await stopApi(processA);
    childProcesses.splice(childProcesses.indexOf(processA), 1);
    await assertPortReleased(port);

    const processB = startApi(port, dataDirectory);
    expect(processB.pid).not.toBe(processA.pid);
    await waitForHealth(baseUrl, processB);

    const healthB = await jsonRequest<{
      status: string;
      database: string;
      schema_version: number;
    }>(baseUrl, "/healthz");
    expect(healthB.response.status).toBe(200);
    expect(healthB.body).toEqual({
      status: "ok",
      database: "ready",
      schema_version: 7,
    });

    const afterRestart = await jsonRequest<typeof beforeRestart.body>(
      baseUrl,
      `/api/v1/findings/${encodeURIComponent(findingKey)}`,
    );
    expect(afterRestart.response.status).toBe(200);
    expect(afterRestart.body).toEqual(beforeRestart.body);
    expect(afterRestart.body.finding.id).toBe(findingId);
    expect(afterRestart.body.remediations).toHaveLength(1);
    expect(afterRestart.body.verifications).toHaveLength(1);
    expect(afterRestart.body.verifications[0]?.verification).toMatchObject({
      id: verification.body.verification.id,
      status: "Failed",
      result_summary: "Intentional failure must survive restart.",
    });
    expect(afterRestart.body.verifications[0]?.checks).toEqual([
      expect.objectContaining({
        status: "Failed",
        message: "Intentional Task 17 failed verification before restart.",
      }),
    ]);

    const list = await jsonRequest<{
      items: Array<{ finding_key: string }>;
      total: number;
    }>(
      baseUrl,
      `/api/v1/findings?search=${encodeURIComponent(findingKey)}&include_verified=true&page_size=100`,
    );
    expect(list.response.status).toBe(200);
    expect(
      list.body.items.filter((item) => item.finding_key === findingKey),
    ).toHaveLength(1);

    await stopApi(processB);
    childProcesses.splice(childProcesses.indexOf(processB), 1);
    await assertPortReleased(port);
  }, 30_000);
});
