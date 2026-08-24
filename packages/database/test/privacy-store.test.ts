import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getDatabaseConnection,
  openRemedenceDatabase,
  type RemedenceDatabase,
} from "../src/database.js";
import { applyMigrations } from "../src/migrations.js";
import { createPrivacyStore } from "../src/privacy-store.js";

const migrationsDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
const now = "2026-08-23T12:00:00.000Z";

let directory: string;
let database: RemedenceDatabase;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "remedence-privacy-store-"));
  database = openRemedenceDatabase({ path: join(directory, "remedence.db") });
  applyMigrations(database, migrationsDirectory);
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("SQLite privacy store", () => {
  it("deletes tenant-only identities and preserves shared users", () => {
    const connection = getDatabaseConnection(database);
    for (const [id, slug] of [
      ["org-delete", "delete"],
      ["org-keep", "keep"],
    ]) {
      connection
        .prepare(
          `INSERT INTO organizations (id, name, slug, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, id, slug, now, now);
    }
    for (const [id, email] of [
      ["user-orphan", "orphan@example.test"],
      ["user-shared", "shared@example.test"],
    ]) {
      connection
        .prepare(
          `INSERT INTO "user"
             (id, name, email, emailVerified, createdAt, updatedAt)
           VALUES (?, ?, ?, 1, ?, ?)`,
        )
        .run(id, id, email, now, now);
      connection
        .prepare(
          `INSERT INTO organization_memberships
             (organization_id, user_id, role, status, created_at, updated_at)
           VALUES ('org-delete', ?, 'Owner', 'Active', ?, ?)`,
        )
        .run(id, now, now);
    }
    connection
      .prepare(
        `INSERT INTO organization_memberships
           (organization_id, user_id, role, status, created_at, updated_at)
         VALUES ('org-keep', 'user-shared', 'Member', 'Active', ?, ?)`,
      )
      .run(now, now);

    createPrivacyStore(database).deleteTenant({
      organizationId: "org-delete",
      receiptId: "receipt-one",
      requestedBy: "user-orphan",
      now,
    });

    const users = connection
      .prepare(`SELECT id FROM "user" ORDER BY id`)
      .all() as unknown as Array<{ id: string }>;
    expect(users.map((row) => row.id)).toEqual(["user-shared"]);
    expect(
      connection
        .prepare("SELECT id FROM organizations WHERE id = 'org-delete'")
        .get(),
    ).toBeUndefined();
  });
});
