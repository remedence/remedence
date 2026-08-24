import { hostname } from "node:os";
import {
  createProcessRunner,
  DockerVerificationSandbox,
  VerificationWorker,
} from "@remedence/verification";
import { getApiConfig } from "./config.js";
import {
  closeDependencies,
  createRuntimeDependencies,
} from "./dependencies.js";
import { ApiVerificationWorkerSource } from "./verification-worker-source.js";

const config = getApiConfig();
const signingKey = process.env.REMEDENCE_WORKER_RECEIPT_SIGNING_KEY ?? "";
if (signingKey.length < 32) {
  throw new Error(
    "REMEDENCE_WORKER_RECEIPT_SIGNING_KEY must contain at least 32 characters.",
  );
}
if (config.verificationProfiles.length === 0) {
  throw new Error("At least one approved verification profile is required.");
}

const dependencies = await createRuntimeDependencies(config);
const queue = dependencies.verificationExecution?.queue;
if (!queue) throw new Error("Verification queue is unavailable.");
const workerId =
  process.env.REMEDENCE_VERIFICATION_WORKER_ID?.trim() ||
  `${hostname()}-${process.pid}`;
const worker = new VerificationWorker({
  workerId,
  queue,
  source: new ApiVerificationWorkerSource(dependencies, signingKey),
  sandbox: new DockerVerificationSandbox(
    createProcessRunner(),
    signingKey,
    process.env.REMEDENCE_DOCKER_EXECUTABLE?.trim() || "docker",
  ),
});

let stopping = false;
process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

try {
  while (!stopping) {
    const worked = await worker.runOnce();
    if (!worked) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
} finally {
  await closeDependencies(dependencies);
}
