import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const services = [
  { name: "api", workspace: "@remedence/api" },
  { name: "web", workspace: "@remedence/web" },
];

function prefixLines(stream, prefix, destination) {
  let buffered = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffered += chunk;
    let newline = buffered.indexOf("\n");
    while (newline >= 0) {
      const line = buffered.slice(0, newline).replace(/\r$/, "");
      destination.write(`${prefix} ${line}\n`);
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf("\n");
    }
  });
  stream.on("end", () => {
    if (buffered.length > 0) destination.write(`${prefix} ${buffered}\n`);
  });
}

function runTaskkill(pid) {
  return new Promise((resolveTaskkill) => {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => resolveTaskkill());
    killer.once("exit", () => resolveTaskkill());
  });
}

async function terminateProcessTree(child) {
  if (
    child.pid === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return;
  }

  if (process.platform === "win32") {
    await runTaskkill(child.pid);
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function spawnService(service, npmCli, output, errorOutput) {
  const child = spawn(
    process.execPath,
    [npmCli, "run", "dev", "-w", service.workspace],
    {
      cwd: repositoryRoot,
      env: process.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  prefixLines(child.stdout, `[${service.name}]`, output);
  prefixLines(child.stderr, `[${service.name}]`, errorOutput);

  const completion = new Promise((resolveCompletion) => {
    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      resolveCompletion(result);
    };
    child.once("error", (error) => finish({ error, code: null, signal: null }));
    child.once("exit", (code, signal) => finish({ error: null, code, signal }));
  });

  return { ...service, child, completion };
}

function unexpectedExitCode(result) {
  return typeof result.code === "number" && result.code !== 0 ? result.code : 1;
}

export async function runDevelopment({
  output = process.stdout,
  errorOutput = process.stderr,
} = {}) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    errorOutput.write(
      "[dev] npm_execpath is unavailable. Start the supervisor with npm run dev.\n",
    );
    return 1;
  }

  const owned = services.map((service) =>
    spawnService(service, npmCli, output, errorOutput),
  );
  let shuttingDown = false;
  let requestedShutdown = false;
  let finalExitCode = 0;
  let shutdownPromise;
  let signalShutdownStarted;
  const shutdownStarted = new Promise((resolveShutdownStarted) => {
    signalShutdownStarted = resolveShutdownStarted;
  });

  const shutdown = async (exitCode, requested, sourceName) => {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    requestedShutdown = requested;
    finalExitCode = exitCode;
    shutdownPromise = (async () => {
      await Promise.all(
        owned
          .filter((service) => service.name !== sourceName)
          .map((service) => terminateProcessTree(service.child)),
      );
      await Promise.all(owned.map((service) => service.completion));
    })();
    signalShutdownStarted();
    return shutdownPromise;
  };

  const onSigint = () => {
    void shutdown(0, true);
  };
  const onSigterm = () => {
    void shutdown(0, true);
  };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  for (const service of owned) {
    void service.completion.then((result) => {
      if (shuttingDown) return;
      const code = unexpectedExitCode(result);
      const reason = result.error
        ? `failed to start: ${result.error.message}`
        : `exited unexpectedly${result.code === null ? ` (${result.signal ?? "unknown signal"})` : ` with code ${result.code}`}`;
      errorOutput.write(`[dev] ${service.name} ${reason}.\n`);
      void shutdown(code, false, service.name);
    });
  }

  try {
    await shutdownStarted;
    await shutdownPromise;
    return requestedShutdown ? 0 : finalExitCode || 1;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  process.exitCode = await runDevelopment();
}
