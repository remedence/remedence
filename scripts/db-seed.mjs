import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMigrations,
  openRemedenceDatabase,
  seedHarborline,
} from "@remedence/database";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = join(root, "packages", "database", "migrations");

function resolveDataDirectory(value) {
  if (value === undefined) return resolve("data");
  const trimmed = value.trim();
  if (!trimmed) throw new Error("REMEDENCE_DATA_DIR must not be empty.");
  return resolve(trimmed);
}

let database;
try {
  const dataDirectory = resolveDataDirectory(process.env.REMEDENCE_DATA_DIR);
  await mkdir(dataDirectory, { recursive: true });
  database = openRemedenceDatabase({
    path: join(dataDirectory, "remedence.db"),
  });
  applyMigrations(database, migrationsDirectory);
  const result = seedHarborline(database, {
    clock: { now: () => new Date().toISOString() },
  });
  console.log(
    result.applied
      ? "Harborline seed applied."
      : "Harborline seed skipped; existing organization data was left unchanged.",
  );
} catch (error) {
  if (
    error instanceof Error &&
    error.message === "REMEDENCE_DATA_DIR must not be empty."
  ) {
    console.error(error.message);
  } else {
    console.error("Database seed failed.");
  }
  process.exitCode = 1;
} finally {
  database?.close();
}
