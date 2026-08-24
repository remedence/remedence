import { setTimeout as delay } from "node:timers/promises";
import { getApiConfig } from "./config.js";
import {
  closeDependencies,
  createRuntimeDependencies,
} from "./dependencies.js";

const dependencies = await createRuntimeDependencies(getApiConfig());
let stopping = false;
process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

async function cleanupReceipt(receipt: {
  id: string;
  objectKeys: string[];
}): Promise<void> {
  let failure = "";
  for (const key of receipt.objectKeys) {
    try {
      await dependencies.evidenceProtection.objectStore.remove(key);
    } catch (error) {
      failure =
        error instanceof Error ? error.message : "Object cleanup failed.";
      break;
    }
  }
  await dependencies.privacy.completeDeletionReceipt(
    receipt.id,
    dependencies.evidenceProtection.clock.now(),
    failure,
  );
}

try {
  while (!stopping) {
    const pending = await dependencies.privacy.listPendingDeletionReceipts();
    for (const receipt of pending) await cleanupReceipt(receipt);
    const retention = await dependencies.privacy.purgeExpiredUnadoptedArtifacts(
      {
        receiptId: dependencies.evidenceProtection.idGenerator.next(),
        now: dependencies.evidenceProtection.clock.now(),
      },
    );
    if (retention) await cleanupReceipt(retention);
    await delay(60_000);
  }
} finally {
  await closeDependencies(dependencies);
}
