import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResultRow,
} from "pg";

const migrationsDirectory = fileURLToPath(
  new URL("../postgres-migrations", import.meta.url),
);

interface TransactionContext {
  database: PostgresDatabase;
  client: PoolClient;
  depth: number;
}

const transactions = new AsyncLocalStorage<TransactionContext>();

export interface OpenPostgresOptions {
  connectionString: string;
  maxConnections?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  ssl?: PoolConfig["ssl"];
}

export class PostgresDatabase {
  readonly pool: Pool;
  schemaVersion = 0;

  constructor(options: OpenPostgresOptions) {
    if (!/^postgres(?:ql)?:\/\//.test(options.connectionString)) {
      throw new Error("A PostgreSQL connection URL is required.");
    }
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxConnections ?? 20,
      idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
      connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
      application_name: "remedence",
      ...(options.ssl !== undefined ? { ssl: options.ssl } : {}),
    });
    this.pool.on("error", () => {
      console.error("Unexpected idle PostgreSQL client error.");
    });
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ) {
    const context = transactions.getStore();
    return context?.database === this
      ? context.client.query<Row>(text, [...values])
      : this.pool.query<Row>(text, [...values]);
  }

  async transaction<T>(operation: () => T | Promise<T>): Promise<T> {
    const parent = transactions.getStore();
    if (parent?.database === this) {
      const savepoint = `remedence_nested_${parent.depth + 1}`;
      await parent.client.query(`SAVEPOINT ${savepoint}`);
      try {
        const value = await transactions.run(
          { ...parent, depth: parent.depth + 1 },
          operation,
        );
        await parent.client.query(`RELEASE SAVEPOINT ${savepoint}`);
        return value;
      } catch (error) {
        await parent.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await parent.client.query(`RELEASE SAVEPOINT ${savepoint}`);
        throw error;
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await transactions.run(
        { database: this, client, depth: 0 },
        operation,
      );
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async probe(): Promise<boolean> {
    const result = await this.query<{ responsive: number }>(
      "SELECT 1 AS responsive",
    );
    return result.rows[0]?.responsive === 1;
  }

  async migrate(): Promise<number> {
    await this.query(`
      CREATE TABLE IF NOT EXISTS remedence_schema_migrations (
        version integer PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const migration = await readFile(
      join(migrationsDirectory, "0001_initial.sql"),
      "utf8",
    );
    await this.transaction(async () => {
      const applied = await this.query<{ present: number }>(
        "SELECT 1 AS present FROM remedence_schema_migrations WHERE version = 1",
      );
      if (applied.rowCount === 0) {
        await this.query(migration);
        await this.query(
          "INSERT INTO remedence_schema_migrations (version) VALUES (1)",
        );
      }
    });
    const version = await this.query<{ version: number }>(
      "SELECT COALESCE(MAX(version), 0)::integer AS version FROM remedence_schema_migrations",
    );
    this.schemaVersion = version.rows[0]?.version ?? 0;
    return this.schemaVersion;
  }

  async loadSchemaVersion(): Promise<number> {
    const version = await this.query<{ version: number }>(
      `SELECT COALESCE(MAX(version), 0)::integer AS version
       FROM remedence_schema_migrations`,
    );
    this.schemaVersion = version.rows[0]?.version ?? 0;
    return this.schemaVersion;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function openPostgresDatabase(
  options: OpenPostgresOptions,
): PostgresDatabase {
  return new PostgresDatabase(options);
}
