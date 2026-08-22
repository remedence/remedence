import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const playwrightCli = resolve(
  repositoryRoot,
  "node_modules",
  "@playwright",
  "test",
  "cli.js",
);
const dataDirectory = await mkdtemp(join(tmpdir(), "remedence-playwright-"));

let exitCode = 1;
try {
  const child = spawn(
    process.execPath,
    [playwrightCli, "test", ...process.argv.slice(2)],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        REMEDENCE_E2E_DATA_DIR: dataDirectory,
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );

  exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
} finally {
  await rm(dataDirectory, { recursive: true, force: true });
}

process.exitCode = exitCode;
