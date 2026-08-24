import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const apiDirectory = join(repositoryRoot, "apps", "api");
const webDirectory = join(repositoryRoot, "apps", "web");
const bunCli = process.env.npm_execpath;
const temporaryDirectories: string[] = [];
const childProcesses: ChildProcess[] = [];

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

function buildWorkspace(workspace: string): void {
  if (!bunCli) {
    throw new Error("Bun is required to run the production smoke test.");
  }
  execFileSync(bunCli, ["run", "--filter", workspace, "build"], {
    cwd: repositoryRoot,
    stdio: "pipe",
  });
}

async function waitForHealth(
  baseUrl: string,
  child: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Production API exited early with code ${child.exitCode}.`,
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
  throw new Error(
    `Production API did not become healthy: ${String(lastError)}`,
  );
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill("SIGTERM");
  await exited;
}

afterEach(async () => {
  for (const child of childProcesses.splice(0)) {
    await stopChild(child);
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("production local mode", () => {
  it("serves the built SPA and persistent API from one loopback origin without API fallthrough", async () => {
    buildWorkspace("@remedence/web");
    buildWorkspace("@remedence/api");

    const dataDirectory = mkdtempSync(join(tmpdir(), "remedence-production-"));
    temporaryDirectories.push(dataDirectory);
    const port = await reserveEphemeralPort();
    const baseUrl = `http://127.0.0.1:${port}`;

    const child = spawn(
      process.execPath,
      [join(apiDirectory, "dist", "server.js")],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          NODE_ENV: "production",
          REMEDENCE_API_PORT: String(port),
          REMEDENCE_DATA_DIR: dataDirectory,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    childProcesses.push(child);
    await waitForHealth(baseUrl, child);

    const rootResponse = await fetch(`${baseUrl}/`);
    expect(rootResponse.status).toBe(200);
    expect(rootResponse.headers.get("content-type")).toMatch(/^text\/html\b/);
    expect(rootResponse.headers.get("cache-control")).toBe("no-cache");
    const rootHtml = await rootResponse.text();
    const builtHtml = readFileSync(
      join(webDirectory, "dist", "index.html"),
      "utf8",
    );
    expect(rootHtml).toBe(builtHtml);

    const assetPath = rootHtml.match(
      /(?:src|href)="(\/assets\/[^"]+-[A-Za-z0-9_-]+\.(?:js|css))"/,
    )?.[1];
    expect(assetPath).toBeDefined();
    const assetResponse = await fetch(`${baseUrl}${assetPath}`);
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get("content-type")).toMatch(
      /^(?:text\/css|text\/javascript|application\/javascript)\b/,
    );
    expect(assetResponse.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );

    const healthResponse = await fetch(`${baseUrl}/healthz`);
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.headers.get("content-type")).toMatch(
      /^application\/json\b/,
    );
    expect(await healthResponse.json()).toEqual({
      status: "ok",
      database: "ready",
      schema_version: 2,
    });

    const dashboardResponse = await fetch(`${baseUrl}/api/v1/dashboard`);
    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.headers.get("content-type")).toMatch(
      /^application\/json\b/,
    );
    const dashboard = (await dashboardResponse.json()) as {
      metrics?: unknown;
      action_queue?: unknown;
    };
    expect(dashboard.metrics).toBeDefined();
    expect(dashboard.action_queue).toBeDefined();

    const unknownApiResponse = await fetch(
      `${baseUrl}/api/v1/definitely-not-a-route`,
    );
    expect(unknownApiResponse.status).toBe(404);
    expect(unknownApiResponse.headers.get("content-type")).toMatch(
      /^application\/problem\+json\b/,
    );
    expect(await unknownApiResponse.json()).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });

    const browserRouteResponse = await fetch(
      `${baseUrl}/some/client/side/route`,
    );
    expect(browserRouteResponse.status).toBe(200);
    expect(browserRouteResponse.headers.get("content-type")).toMatch(
      /^text\/html\b/,
    );
    expect(browserRouteResponse.headers.get("cache-control")).toBe("no-cache");
    expect(await browserRouteResponse.text()).toBe(builtHtml);

    const unknownMutationResponse = await fetch(
      `${baseUrl}/api/v1/definitely-not-a-route`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(unknownMutationResponse.status).toBe(404);
    expect(unknownMutationResponse.headers.get("content-type")).toMatch(
      /^application\/problem\+json\b/,
    );
    expect(await unknownMutationResponse.text()).not.toContain("<html");
  }, 60_000);
});
