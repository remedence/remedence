import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { getApiConfig } from "./config.js";
import { closeDependencies, createDependencies } from "./dependencies.js";
import {
  IntegrationDeliveryWorker,
  IntegrationDispatcher,
} from "./integration-runtime.js";

const dependencies = createDependencies(getApiConfig());
const worker = new IntegrationDeliveryWorker(
  dependencies.integrations.store,
  new IntegrationDispatcher(dependencies.integrations.credentials),
  process.env.REMEDENCE_INTEGRATION_WORKER_ID?.trim() ||
    `${hostname()}-${process.pid}`,
);
let stopping = false;
process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});
try {
  while (!stopping) {
    if (!(await worker.runOnce())) await delay(1_000);
  }
} finally {
  closeDependencies(dependencies);
}
