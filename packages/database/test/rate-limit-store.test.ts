import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  getDatabaseConnection,
  openRemedenceDatabase,
  type RemedenceDatabase,
} from "../src/database.js";
import { applyMigrations } from "../src/migrations.js";
import { createRateLimitStore } from "../src/rate-limit-store.js";

const migrationsDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
const directories: string[] = [];
const databases: RemedenceDatabase[] = [];

function openShared(path?: string) {
  const directory = path
    ? undefined
    : mkdtempSync(join(tmpdir(), "rate-store-"));
  if (directory) directories.push(directory);
  const databasePath = path ?? join(directory!, "remedence.db");
  const database = openRemedenceDatabase({ path: databasePath });
  applyMigrations(database, migrationsDirectory);
  databases.push(database);
  return { database, path: databasePath };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite rate limit store", () => {
  it("coordinates one bucket across independent store instances", () => {
    const { database } = openShared();
    const firstStore = createRateLimitStore(database);
    const secondStore = createRateLimitStore(database);

    expect(firstStore.consume("tenant:one", 1_000, 10_000).count).toBe(1);
    expect(secondStore.consume("tenant:one", 1_001, 10_000).count).toBe(2);
  });

  it("keeps tenant buckets independent", () => {
    const { database } = openShared();
    const store = createRateLimitStore(database);

    expect(store.consume("tenant:one", 1_000, 10_000).count).toBe(1);
    expect(store.consume("tenant:two", 1_000, 10_000).count).toBe(1);
  });

  it("resets expired windows and evicts inactive keys", () => {
    const { database } = openShared();
    const store = createRateLimitStore(database);
    store.consume("inactive", 1_000, 1_000);

    const reset = store.consume("active", 12_000, 1_000);

    expect(reset).toEqual({ count: 1, resetAt: 13_000 });
    expect(
      getDatabaseConnection(database)
        .prepare(
          "SELECT bucket_key FROM rate_limit_buckets ORDER BY bucket_key",
        )
        .all(),
    ).toEqual([{ bucket_key: "active" }]);
  });
});
