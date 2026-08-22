import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { backup } from "node:sqlite";
import { getDatabaseConnection, type RemedenceDatabase } from "./database.js";

function comparablePath(path: string): string {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export async function backupDatabase(
  source: RemedenceDatabase,
  destination: string,
): Promise<void> {
  const sourcePath = resolve(source.path);
  const destinationPath = resolve(destination);

  if (comparablePath(sourcePath) === comparablePath(destinationPath)) {
    throw new Error(
      "Backup destination must differ from the live database path.",
    );
  }
  if (existsSync(destinationPath)) {
    throw new Error("Backup destination already exists.");
  }

  await mkdir(dirname(destinationPath), { recursive: true });
  await backup(getDatabaseConnection(source), destinationPath);
}
