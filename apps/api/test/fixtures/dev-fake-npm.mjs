import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const workspaceIndex = process.argv.indexOf("--filter");
const workspace = workspaceIndex >= 0 ? process.argv[workspaceIndex + 1] : "";
const role = workspace === "@remedence/api" ? "api" : "web";
const mode = process.env.REMEDENCE_DEV_FIXTURE_MODE ?? "signal";
const failureRole = process.env.REMEDENCE_DEV_FIXTURE_FAILURE_ROLE ?? "api";

function recordPid(name, pid) {
  const path = process.env[`REMEDENCE_DEV_FIXTURE_${name}_PID_FILE`];
  if (path) writeFileSync(path, String(pid));
}

function spawnGrandchild() {
  const grandchild = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { stdio: "ignore" },
  );
  recordPid(`${role.toUpperCase()}_GRANDCHILD`, grandchild.pid);
}

async function waitForSiblingTree() {
  const siblingRole = role === "api" ? "WEB" : "API";
  const required = [
    process.env[`REMEDENCE_DEV_FIXTURE_${siblingRole}_PID_FILE`],
    process.env[`REMEDENCE_DEV_FIXTURE_${siblingRole}_GRANDCHILD_PID_FILE`],
  ].filter(Boolean);
  const deadline = Date.now() + 5_000;

  while (!required.every((path) => existsSync(path))) {
    if (Date.now() >= deadline) process.exit(98);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

recordPid(role.toUpperCase(), process.pid);
console.log(`${role} fixture ready pid=${process.pid}`);

if (mode === "startup-failure" && role === failureRole) {
  await waitForSiblingTree();
  process.exit(9);
} else if (mode === "unexpected" && role === failureRole) {
  setTimeout(() => process.exit(7), 120);
} else {
  spawnGrandchild();
  setInterval(() => {}, 1000);
}
