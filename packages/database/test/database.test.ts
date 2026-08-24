import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getDatabaseConnection,
  openRemedenceDatabase,
  type RemedenceDatabase,
} from "../src/database.js";
import { applyMigrations } from "../src/migrations.js";
import { runTransaction } from "../src/transaction.js";

const migrationsDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

let temporaryDirectory: string;
let database: RemedenceDatabase | undefined;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "remedence-database-"));
});

afterEach(() => {
  if (database) {
    database.close();
    database = undefined;
  }
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function openDatabase(): RemedenceDatabase {
  const path = join(temporaryDirectory, "remedence.db");
  database = openRemedenceDatabase({ path });
  return database;
}

function connection(): DatabaseSync {
  if (!database) throw new Error("Database has not been opened.");
  return getDatabaseConnection(database);
}

function migrate(): RemedenceDatabase {
  const opened = openDatabase();
  expect(applyMigrations(opened, migrationsDirectory)).toBe(9);
  return opened;
}

function insertOrganizationAndCompany(): void {
  const db = connection();
  db.prepare(
    `INSERT INTO organizations (
      id, name, slug, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    "org-harborline",
    "Harborline Technology Group",
    "harborline-technology-group",
    "2026-08-20T00:00:00.000Z",
    "2026-08-20T00:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO companies (
      id, organization_id, name, risk_score, risk_level, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "company-juniper",
    "org-harborline",
    "Juniper Ridge Dental",
    82,
    "Critical",
    "2026-08-20T00:00:00.000Z",
    "2026-08-20T00:00:00.000Z",
  );
}

describe("database lifecycle", () => {
  it("opens a file-backed database with the approved hardened defaults", () => {
    const opened = openDatabase();
    const db = connection();

    expect(existsSync(opened.path)).toBe(true);
    expect(db.prepare("PRAGMA foreign_keys").get()).toMatchObject({
      foreign_keys: 1,
    });
    expect(db.prepare("PRAGMA journal_mode").get()).toMatchObject({
      journal_mode: "wal",
    });
    expect(db.prepare("PRAGMA synchronous").get()).toMatchObject({
      synchronous: 1,
    });
    expect(db.prepare("PRAGMA busy_timeout").get()).toMatchObject({
      timeout: 5000,
    });

    expect(() => db.enableLoadExtension(true)).toThrow();

    db.exec("PRAGMA writable_schema = ON");
    expect(db.prepare("PRAGMA writable_schema").get()).toMatchObject({
      writable_schema: 0,
    });

    const statement = db.prepare("SELECT :known AS value");
    expect(() => statement.get({ known: 1, unexpected: 2 })).toThrow();

    const limits = (
      db as DatabaseSync & {
        limits: {
          sqlLength: number;
          variableNumber: number;
          exprDepth: number;
          attach: number;
        };
      }
    ).limits;
    expect(limits.sqlLength).toBe(1_000_000);
    expect(limits.variableNumber).toBe(500);
    expect(limits.exprDepth).toBe(100);
    expect(limits.attach).toBe(0);
    expect(() => db.exec("ATTACH DATABASE ':memory:' AS forbidden")).toThrow();
  });

  it("applies every migration exactly once", () => {
    const opened = openDatabase();

    expect(applyMigrations(opened, migrationsDirectory)).toBe(9);
    expect(opened.schemaVersion).toBe(9);

    const tables = connection()
      .prepare(
        `SELECT name
         FROM sqlite_schema
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual([
      "account",
      "audit_events",
      "companies",
      "evidence_artifacts",
      "evidence_items",
      "findings",
      "idempotency_records",
      "organization_memberships",
      "organizations",
      "rate_limit_buckets",
      "remediations",
      "reports",
      "schema_migrations",
      "session",
      "ssoProvider",
      "twoFactor",
      "user",
      "verification",
      "verification_checks",
      "verification_execution_receipts",
      "verification_jobs",
      "verification_runs",
    ]);

    expect(applyMigrations(opened, migrationsDirectory)).toBe(9);
    expect(opened.schemaVersion).toBe(9);
    expect(
      connection()
        .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
        .get(),
    ).toMatchObject({ count: 9 });
  });

  it("rejects companies that reference a missing organization", () => {
    migrate();

    const insert = connection().prepare(
      `INSERT INTO companies (
        id, organization_id, name, risk_score, risk_level, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    expect(() =>
      insert.run(
        "company-invalid",
        "org-missing",
        "Invalid Company",
        10,
        "Low",
        "2026-08-20T00:00:00.000Z",
        "2026-08-20T00:00:00.000Z",
      ),
    ).toThrow();
  });

  it("enforces finding keys case-insensitively per organization", () => {
    migrate();
    insertOrganizationAndCompany();

    const insert = connection().prepare(
      `INSERT INTO findings (
        id, organization_id, company_id, finding_key, title, description,
        source, severity, state, owner, asset_name, detected_at, sla_due_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    insert.run(
      "finding-1",
      "org-harborline",
      "company-juniper",
      "SEC-1042",
      "SQL injection",
      "Primary query path",
      "Manual",
      "Critical",
      "Needs remediation",
      "L. Chen",
      "Patient Portal API",
      "2026-08-20T00:00:00.000Z",
      "2026-08-21T00:00:00.000Z",
      "2026-08-20T00:00:00.000Z",
      "2026-08-20T00:00:00.000Z",
    );

    expect(() =>
      insert.run(
        "finding-2",
        "org-harborline",
        "company-juniper",
        "sec-1042",
        "Duplicate SQL injection",
        "Secondary copy",
        "Manual",
        "Critical",
        "Needs remediation",
        "L. Chen",
        "Patient Portal API",
        "2026-08-20T00:00:00.000Z",
        "2026-08-21T00:00:00.000Z",
        "2026-08-20T00:00:00.000Z",
        "2026-08-20T00:00:00.000Z",
      ),
    ).toThrow();
  });

  it("rolls back every write when a transaction operation throws", () => {
    const opened = migrate();
    const failure = new Error("stop transaction");

    let caught: unknown;
    try {
      runTransaction(opened, () => {
        insertOrganizationAndCompany();
        throw failure;
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(failure);
    expect(
      connection().prepare("SELECT COUNT(*) AS count FROM organizations").get(),
    ).toMatchObject({ count: 0 });
    expect(
      connection().prepare("SELECT COUNT(*) AS count FROM companies").get(),
    ).toMatchObject({ count: 0 });
  });

  it("rolls back a failed migration without leaving partial schema", () => {
    const opened = openDatabase();
    const brokenDirectory = join(temporaryDirectory, "broken-migrations");
    mkdirSync(brokenDirectory);
    writeFileSync(
      join(brokenDirectory, "0001_broken.sql"),
      "CREATE TABLE partial_table (id TEXT) STRICT;\nTHIS IS NOT SQL;\n",
      "utf8",
    );

    expect(() => applyMigrations(opened, brokenDirectory)).toThrow(
      /0001_broken\.sql/,
    );
    expect(
      connection()
        .prepare(
          `SELECT name
           FROM sqlite_schema
           WHERE type = 'table' AND name IN ('partial_table', 'schema_migrations')`,
        )
        .all(),
    ).toEqual([]);
    expect(opened.schemaVersion).toBe(0);
  });
});
