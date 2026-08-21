import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const supervisorPath = join(repositoryRoot, "scripts", "dev.mjs");
const fakeNpmPath = join(
  repositoryRoot,
  "apps",
  "api",
  "test",
  "fixtures",
  "dev-fake-npm.mjs",
);
const temporaryDirectories: string[] = [];
const trackedChildren: ChildProcess[] = [];
const trackedPids = new Set<number>();

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPid(pid: number): void {
  if (!isAlive(pid)) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // The process may have exited between the liveness check and cleanup.
  }
}

function killOwnedTree(pid: number): void {
  if (!isAlive(pid)) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  killPid(pid);
}

function pidFiles(directory: string) {
  return {
    api: join(directory, "api.pid"),
    apiGrandchild: join(directory, "api-grandchild.pid"),
    web: join(directory, "web.pid"),
    webGrandchild: join(directory, "web-grandchild.pid"),
  };
}

function fixtureEnvironment(
  directory: string,
  mode: "unexpected" | "signal",
): NodeJS.ProcessEnv {
  const files = pidFiles(directory);
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === "npm_execpath") delete environment[key];
  }
  return {
    ...environment,
    npm_execpath: fakeNpmPath,
    REMEDENCE_DEV_FIXTURE_MODE: mode,
    REMEDENCE_DEV_FIXTURE_API_PID_FILE: files.api,
    REMEDENCE_DEV_FIXTURE_API_GRANDCHILD_PID_FILE: files.apiGrandchild,
    REMEDENCE_DEV_FIXTURE_WEB_PID_FILE: files.web,
    REMEDENCE_DEV_FIXTURE_WEB_GRANDCHILD_PID_FILE: files.webGrandchild,
  };
}

async function waitForExit(child: ChildProcess): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
}> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (child.pid !== undefined) killOwnedTree(child.pid);
      reject(new Error("Timed out waiting for the dev supervisor to exit."));
    }, 8_000);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function capture(child: ChildProcess): Promise<{
  exit: { code: number | null; signal: NodeJS.Signals | null };
  stdout: string;
  stderr: string;
}> {
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  return waitForExit(child).then((exit) => ({ exit, stdout, stderr }));
}

function readTrackedPid(path: string): number {
  const pid = Number(readFileSync(path, "utf8"));
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Invalid fixture PID in ${path}.`);
  }
  trackedPids.add(pid);
  return pid;
}

function expectStopped(pid: number): void {
  expect(isAlive(pid), `expected fixture PID ${pid} to be stopped`).toBe(false);
}

afterEach(() => {
  for (const child of trackedChildren.splice(0)) {
    if (child.pid !== undefined) killPid(child.pid);
  }
  for (const pid of trackedPids) killPid(pid);
  trackedPids.clear();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("development process supervisor", () => {
  it("terminates only its owned sibling process tree when one service exits unexpectedly", async () => {
    const directory = mkdtempSync(join(tmpdir(), "remedence-dev-unexpected-"));
    temporaryDirectories.push(directory);
    const unrelated = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {
        stdio: "ignore",
      },
    );
    trackedChildren.push(unrelated);
    expect(unrelated.pid).toBeDefined();

    const supervisor = spawn(process.execPath, [supervisorPath], {
      cwd: repositoryRoot,
      env: fixtureEnvironment(directory, "unexpected"),
      stdio: ["ignore", "pipe", "pipe"],
    });
    trackedChildren.push(supervisor);
    const result = await capture(supervisor);

    expect(result.exit).toEqual({ code: 7, signal: null });
    expect(result.stdout).toContain("[api] api fixture ready");
    expect(result.stdout).toContain("[web] web fixture ready");

    const files = pidFiles(directory);
    const webPid = readTrackedPid(files.web);
    const webGrandchildPid = readTrackedPid(files.webGrandchild);
    expectStopped(webPid);
    expectStopped(webGrandchildPid);
    expect(isAlive(unrelated.pid!)).toBe(true);
  }, 15_000);

  it.each(["SIGINT", "SIGTERM"] as const)(
    "cleans up both owned process trees and exits cleanly on %s",
    async (signal) => {
      const directory = mkdtempSync(
        join(tmpdir(), `remedence-dev-${signal.toLowerCase()}-`),
      );
      temporaryDirectories.push(directory);
      const files = pidFiles(directory);
      const requiredFiles = Object.values(files);
      const moduleUrl = pathToFileURL(supervisorPath).href;
      const runner = `
        import { existsSync } from "node:fs";
        const { runDevelopment } = await import(${JSON.stringify(moduleUrl)});
        const required = ${JSON.stringify(requiredFiles)};
        const deadline = Date.now() + 5000;
        const timer = setInterval(() => {
          if (required.every((path) => existsSync(path))) {
            clearInterval(timer);
            process.emit(${JSON.stringify(signal)});
          } else if (Date.now() >= deadline) {
            clearInterval(timer);
            process.exitCode = 99;
            process.emit(${JSON.stringify(signal)});
          }
        }, 10);
        const code = await runDevelopment();
        clearInterval(timer);
        process.exitCode = code;
      `;
      const supervisor = spawn(
        process.execPath,
        ["--input-type=module", "--eval", runner],
        {
          cwd: repositoryRoot,
          env: fixtureEnvironment(directory, "signal"),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      trackedChildren.push(supervisor);
      const result = await capture(supervisor);

      expect(result.exit).toEqual({ code: 0, signal: null });
      expect(result.stdout).toContain("[api] api fixture ready");
      expect(result.stdout).toContain("[web] web fixture ready");

      for (const path of requiredFiles) {
        expect(existsSync(path)).toBe(true);
        expectStopped(readTrackedPid(path));
      }
    },
    15_000,
  );
});
