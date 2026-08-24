import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  openRemedenceDatabase,
  type RemedenceDatabase,
} from "../src/database.js";
import {
  createIdempotencyStore,
  type IdempotencyScope,
} from "../src/idempotency-store.js";
import { applyMigrations } from "../src/migrations.js";

const migrationsDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
const createdAt = "2026-08-23T12:00:00.000Z";
const expiresAt = "2026-08-24T12:00:00.000Z";
const scope: IdempotencyScope = {
  organizationId: "org-one",
  actorId: "user-one",
  key: "request-key-one",
  operation: "POST /imports",
  requestHash: "a".repeat(64),
};

let directory: string;
let database: RemedenceDatabase;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "remedence-idempotency-"));
  database = openRemedenceDatabase({ path: join(directory, "remedence.db") });
  applyMigrations(database, migrationsDirectory);
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("SQLite idempotency store", () => {
  it("reserves once and blocks an overlapping execution", () => {
    const store = createIdempotencyStore(database);

    expect(store.begin(scope, createdAt, expiresAt)).toEqual({
      outcome: "reserved",
    });
    expect(store.begin(scope, createdAt, expiresAt)).toEqual({
      outcome: "in-progress",
    });
  });

  it("durably replays the completed status, headers, and body", () => {
    const store = createIdempotencyStore(database);
    store.begin(scope, createdAt, expiresAt);
    store.complete(
      scope,
      201,
      { location: "/api/v1/findings/SEC-1" },
      { finding: { id: "finding-one" } },
      createdAt,
    );

    expect(store.begin(scope, createdAt, expiresAt)).toEqual({
      outcome: "replay",
      response: {
        statusCode: 201,
        headers: { location: "/api/v1/findings/SEC-1" },
        body: { finding: { id: "finding-one" } },
      },
    });
  });

  it("rejects key reuse across payloads or operations", () => {
    const store = createIdempotencyStore(database);
    store.begin(scope, createdAt, expiresAt);

    expect(
      store.begin(
        { ...scope, requestHash: "b".repeat(64) },
        createdAt,
        expiresAt,
      ),
    ).toEqual({ outcome: "key-reused" });
    expect(
      store.begin(
        { ...scope, operation: "POST /reports" },
        createdAt,
        expiresAt,
      ),
    ).toEqual({ outcome: "key-reused" });
  });

  it("releases failed attempts so corrected retries can execute", () => {
    const store = createIdempotencyStore(database);
    store.begin(scope, createdAt, expiresAt);
    store.release(scope);

    expect(store.begin(scope, createdAt, expiresAt)).toEqual({
      outcome: "reserved",
    });
  });
});
