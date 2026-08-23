import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  openSync,
  readSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import { getDatabaseConnection, openRemedenceDatabase } from "./database.js";
import { applyMigrations } from "./migrations.js";

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "ascii");

function requireSqliteHeader(databasePath: string): void {
  const descriptor = openSync(databasePath, "r");
  try {
    const header = Buffer.alloc(SQLITE_HEADER.length);
    const bytesRead = readSync(descriptor, header, 0, header.length, 0);
    if (bytesRead !== header.length || !header.equals(SQLITE_HEADER)) {
      throw new Error("Backup is not a SQLite database file.");
    }
  } finally {
    closeSync(descriptor);
  }
}

function requireIntegrityCheck(databasePath: string): void {
  const database = openRemedenceDatabase({
    path: databasePath,
    readOnly: true,
  });
  try {
    const rows = getDatabaseConnection(database)
      .prepare("PRAGMA integrity_check")
      .all() as unknown as Array<{ integrity_check: string }>;
    if (
      rows.length !== 1 ||
      rows[0]?.integrity_check.toLocaleLowerCase("en-US") !== "ok"
    ) {
      throw new Error("Backup failed SQLite integrity validation.");
    }
  } finally {
    database.close();
  }
}

export function restoreDatabaseBackup(
  backupPath: string,
  destinationPath: string,
  migrationsDirectory: string,
): void {
  const source = resolve(backupPath);
  const destination = resolve(destinationPath);
  if (source === destination) {
    throw new Error("Restore destination must differ from the backup path.");
  }
  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new Error("Backup file does not exist or is not a regular file.");
  }
  if (existsSync(destination)) {
    throw new Error("Restore destination already exists.");
  }

  requireSqliteHeader(source);
  requireIntegrityCheck(source);
  const backup = openRemedenceDatabase({ path: source, readOnly: true });
  try {
    applyMigrations(backup, migrationsDirectory);
  } finally {
    backup.close();
  }

  copyFileSync(source, destination, constants.COPYFILE_EXCL);
  requireIntegrityCheck(destination);
}
