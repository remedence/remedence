import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getDatabaseConnection, type RemedenceDatabase } from "./database.js";

interface Migration {
  version: number;
  filename: string;
  sql: string;
}

interface AppliedMigrationRow {
  version: number;
  filename: string;
}

function loadMigrations(directory: string): Migration[] {
  const versions = new Set<number>();
  const migrations: Migration[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".sql")) continue;

    const match = /^(\d+)_.*\.sql$/i.exec(entry.name);
    if (!match?.[1]) {
      throw new Error(
        `Migration filename must start with a numeric prefix: ${entry.name}`,
      );
    }

    const version = Number.parseInt(match[1], 10);
    if (!Number.isSafeInteger(version) || version <= 0) {
      throw new Error(`Migration version is invalid: ${entry.name}`);
    }
    if (versions.has(version)) {
      throw new Error(`Duplicate migration version ${version}: ${entry.name}`);
    }
    versions.add(version);

    migrations.push({
      version,
      filename: entry.name,
      sql: readFileSync(join(directory, entry.name), "utf8"),
    });
  }

  return migrations.sort(
    (left, right) =>
      left.version - right.version ||
      left.filename.localeCompare(right.filename),
  );
}

function schemaMigrationsExist(database: RemedenceDatabase): boolean {
  return Boolean(
    getDatabaseConnection(database)
      .prepare(
        `SELECT 1 AS present
         FROM sqlite_schema
         WHERE type = 'table' AND name = 'schema_migrations'`,
      )
      .get(),
  );
}

function readAppliedMigrations(
  database: RemedenceDatabase,
): Map<number, string> {
  if (!schemaMigrationsExist(database)) return new Map();

  const rows = getDatabaseConnection(database)
    .prepare("SELECT version, filename FROM schema_migrations ORDER BY version")
    .all() as unknown as AppliedMigrationRow[];
  return new Map(rows.map((row) => [row.version, row.filename]));
}

function migrationFailure(filename: string, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new Error(`Failed to apply migration ${filename}: ${detail}`, {
    cause,
  });
}

export function applyMigrations(
  database: RemedenceDatabase,
  migrationsDirectory: string,
): number {
  const connection = getDatabaseConnection(database);
  const migrations = loadMigrations(migrationsDirectory);
  const applied = readAppliedMigrations(database);
  const currentVersion = Math.max(0, ...applied.keys());
  database.schemaVersion = currentVersion;

  for (const migration of migrations) {
    const appliedFilename = applied.get(migration.version);
    if (appliedFilename !== undefined) {
      if (appliedFilename !== migration.filename) {
        throw new Error(
          `Migration version ${migration.version} was applied as ${appliedFilename}, not ${migration.filename}.`,
        );
      }
      continue;
    }

    if (migration.version <= database.schemaVersion) {
      throw new Error(
        `Migration history is inconsistent at version ${migration.version}.`,
      );
    }

    connection.exec("BEGIN IMMEDIATE");
    try {
      connection.exec(migration.sql);
      connection
        .prepare(
          `INSERT INTO schema_migrations (version, filename, applied_at)
           VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        )
        .run(migration.version, migration.filename);
      connection.exec("COMMIT");
      database.schemaVersion = migration.version;
      applied.set(migration.version, migration.filename);
    } catch (error) {
      let rollbackError: unknown;
      try {
        if (connection.isTransaction) connection.exec("ROLLBACK");
      } catch (caughtRollbackError) {
        rollbackError = caughtRollbackError;
      }

      const failure = migrationFailure(migration.filename, error);
      if (rollbackError !== undefined) {
        throw new AggregateError(
          [failure, rollbackError],
          `Migration ${migration.filename} failed and rollback also failed.`,
          { cause: failure },
        );
      }
      throw failure;
    }
  }

  return database.schemaVersion;
}
