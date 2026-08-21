import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const workspaceIndex = process.argv.indexOf("-w");
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

recordPid(role.toUpperCase(), process.pid);
console.log(`${role} fixture ready pid=${process.pid}`);

if (mode === "startup-failure" && role === failureRole) {
  process.exit(9);
} else if (mode === "unexpected" && role === failureRole) {
  setTimeout(() => process.exit(7), 120);
} else {
  spawnGrandchild();
  setInterval(() => {}, 1000);
}
