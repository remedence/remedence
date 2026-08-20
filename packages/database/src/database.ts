import { DatabaseSync } from "node:sqlite";

export interface OpenDatabaseOptions {
  path: string;
  readOnly?: boolean;
}

export interface RemedenceDatabase {
  readonly path: string;
  schemaVersion: number;
  close(): void;
}

interface RuntimeDatabaseLimits {
  sqlLength: number;
  variableNumber: number;
  exprDepth: number;
  attach: number;
}

const connections = new WeakMap<RemedenceDatabase, DatabaseSync>();

function readSchemaVersion(connection: DatabaseSync): number {
  const table = connection
    .prepare(
      `SELECT 1 AS present
       FROM sqlite_schema
       WHERE type = 'table' AND name = 'schema_migrations'`,
    )
    .get();

  if (!table) return 0;

  const row = connection
    .prepare(
      "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
    )
    .get() as { version: number } | undefined;
  return row?.version ?? 0;
}

function requireRuntimeLimits(connection: DatabaseSync): RuntimeDatabaseLimits {
  const limits = (connection as DatabaseSync & { limits?: unknown }).limits;
  if (!limits || typeof limits !== "object") {
    throw new Error(
      "This Node.js runtime does not expose the SQLite limits API required by Remedence.",
    );
  }

  const runtimeLimits = limits as Partial<RuntimeDatabaseLimits>;
  if (
    typeof runtimeLimits.sqlLength !== "number" ||
    typeof runtimeLimits.variableNumber !== "number" ||
    typeof runtimeLimits.exprDepth !== "number" ||
    typeof runtimeLimits.attach !== "number"
  ) {
    throw new Error(
      "This Node.js runtime exposes an incompatible SQLite limits API.",
    );
  }

  return runtimeLimits as RuntimeDatabaseLimits;
}

function applyConnectionProtections(
  connection: DatabaseSync,
  readOnly: boolean,
): void {
  if (!readOnly) {
    connection.exec("PRAGMA journal_mode = WAL");
    connection.exec("PRAGMA synchronous = NORMAL");
  }

  const limits = requireRuntimeLimits(connection);
  limits.sqlLength = 1_000_000;
  limits.variableNumber = 500;
  limits.exprDepth = 100;
  limits.attach = 0;
}

export function openRemedenceDatabase(
  options: OpenDatabaseOptions,
): RemedenceDatabase {
  const readOnly = options.readOnly ?? false;
  const connection = new DatabaseSync(options.path, {
    readOnly,
    timeout: 5_000,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowUnknownNamedParameters: false,
    allowExtension: false,
    defensive: true,
  });

  try {
    applyConnectionProtections(connection, readOnly);
  } catch (error) {
    connection.close();
    throw error;
  }

  let closed = false;
  const database: RemedenceDatabase = {
    path: options.path,
    schemaVersion: readSchemaVersion(connection),
    close(): void {
      if (closed) return;
      connection.close();
      connections.delete(database);
      closed = true;
    },
  };

  connections.set(database, connection);
  return database;
}

export function getDatabaseConnection(
  database: RemedenceDatabase,
): DatabaseSync {
  const connection = connections.get(database);
  if (!connection) {
    throw new Error("Remedence database is closed or was not opened here.");
  }
  return connection;
}
