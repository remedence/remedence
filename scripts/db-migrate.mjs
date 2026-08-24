import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMigrations,
  openPostgresDatabase,
  openRemedenceDatabase,
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
  if (process.env.REMEDENCE_DATABASE_URL) {
    database = openPostgresDatabase({
      connectionString: process.env.REMEDENCE_DATABASE_URL,
    });
    const schemaVersion = await database.migrate();
    console.log(
      `PostgreSQL migrations applied (schema version ${schemaVersion}).`,
    );
    process.exitCode = 0;
  } else {
    const dataDirectory = resolveDataDirectory(process.env.REMEDENCE_DATA_DIR);
    await mkdir(dataDirectory, { recursive: true });
    database = openRemedenceDatabase({
      path: join(dataDirectory, "remedence.db"),
    });
    const schemaVersion = applyMigrations(database, migrationsDirectory);
    console.log(
      `Database migrations applied (schema version ${schemaVersion}).`,
    );
  }
} catch (error) {
  if (
    error instanceof Error &&
    error.message === "REMEDENCE_DATA_DIR must not be empty."
  ) {
    console.error(error.message);
  } else {
    console.error("Database migration failed.");
  }
  process.exitCode = 1;
} finally {
  await database?.close();
}
