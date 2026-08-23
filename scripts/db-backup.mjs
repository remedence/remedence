import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { backupDatabase, openRemedenceDatabase } from "@remedence/database";

function resolveDataDirectory(value) {
  if (value === undefined) return resolve("data");
  const trimmed = value.trim();
  if (!trimmed) throw new Error("REMEDENCE_DATA_DIR must not be empty.");
  return resolve(trimmed);
}

function parseOutputArgument(args) {
  if (args.length !== 2 || args[0] !== "--output" || !args[1]?.trim()) {
    throw new Error("Usage: bun run db:backup --output <file>");
  }
  return resolve(args[1]);
}

function safeOperationalMessage(error) {
  if (!(error instanceof Error)) return "Database backup failed.";
  const allowed = new Set([
    "REMEDENCE_DATA_DIR must not be empty.",
    "Usage: bun run db:backup --output <file>",
    "Live Remedence database does not exist.",
    "Backup destination must differ from the live database path.",
    "Backup destination already exists.",
  ]);
  return allowed.has(error.message) ? error.message : "Database backup failed.";
}

let database;
try {
  const dataDirectory = resolveDataDirectory(process.env.REMEDENCE_DATA_DIR);
  const sourcePath = join(dataDirectory, "remedence.db");
  const destination = parseOutputArgument(process.argv.slice(2));
  if (!existsSync(sourcePath)) {
    throw new Error("Live Remedence database does not exist.");
  }

  database = openRemedenceDatabase({ path: sourcePath, readOnly: true });
  await backupDatabase(database, destination);
  console.log("Database backup completed.");
} catch (error) {
  console.error(safeOperationalMessage(error));
  process.exitCode = 1;
} finally {
  database?.close();
}
