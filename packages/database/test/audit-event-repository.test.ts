import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RemedenceDatabase } from "../src/database.js";
import {
  getDatabaseConnection,
  openRemedenceDatabase,
} from "../src/database.js";
import { applyMigrations } from "../src/migrations.js";
import { createAuditEventRepository } from "../src/repositories/audit-event-repository.js";

const migrationsDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

let temporaryDirectory: string;
let database: RemedenceDatabase;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(
    join(tmpdir(), "remedence-audit-repository-"),
  );
  database = openRemedenceDatabase({
    path: join(temporaryDirectory, "remedence.db"),
  });
  applyMigrations(database, migrationsDirectory);

  const connection = getDatabaseConnection(database);
  const insertOrganization = connection.prepare(
    `INSERT INTO organizations (id, name, slug, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  insertOrganization.run(
    "org-harborline",
    "Harborline Technology Group",
    "harborline",
    "2026-08-01T00:00:00.000Z",
    "2026-08-01T00:00:00.000Z",
  );
  insertOrganization.run(
    "org-other",
    "Other Organization",
    "other",
    "2026-08-01T00:00:00.000Z",
    "2026-08-01T00:00:00.000Z",
  );

  const insertEvent = connection.prepare(
    `INSERT INTO audit_events (
       organization_id, actor_type, actor_id, action, entity_type, entity_id,
       details_json, occurred_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertEvent.run(
    "org-harborline",
    "operator",
    "local-user",
    "finding.imported",
    "finding",
    "finding-1",
    '{"position":1}',
    "2026-08-10T10:00:00.000Z",
  );
  insertEvent.run(
    "org-harborline",
    "operator",
    "local-user",
    "verification.failed",
    "verification",
    "verification-1",
    '{"position":2}',
    "2026-08-10T11:00:00.000Z",
  );
  insertEvent.run(
    "org-harborline",
    "operator",
    "local-user",
    "finding.state_changed",
    "finding",
    "finding-1",
    '{"position":3}',
    "2026-08-10T12:00:00.000Z",
  );
  insertEvent.run(
    "org-other",
    "operator",
    "local-user",
    "finding.imported",
    "finding",
    "finding-other",
    '{"position":99}',
    "2026-08-10T09:00:00.000Z",
  );
});

afterEach(() => {
  database.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("AuditEventRepository", () => {
  it("returns events in increasing event ID order and scopes by organization", () => {
    const repository = createAuditEventRepository(database);
    const page = repository.list({
      organizationId: "org-harborline",
      page: 1,
      pageSize: 25,
    });

    expect(page.items.map((event) => event.details.position)).toEqual([
      1, 2, 3,
    ]);
    expect(
      page.items.every((event) => event.organizationId === "org-harborline"),
    ).toBe(true);
  });

  it("filters by entity type", () => {
    const repository = createAuditEventRepository(database);
    const page = repository.list({
      organizationId: "org-harborline",
      entityType: "verification",
      page: 1,
      pageSize: 25,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.entityId).toBe("verification-1");
  });

  it("filters by entity ID", () => {
    const repository = createAuditEventRepository(database);
    const page = repository.list({
      organizationId: "org-harborline",
      entityId: "finding-1",
      page: 1,
      pageSize: 25,
    });

    expect(page.items.map((event) => event.action)).toEqual([
      "finding.imported",
      "finding.state_changed",
    ]);
  });

  it("filters by inclusive time range", () => {
    const repository = createAuditEventRepository(database);
    const page = repository.list({
      organizationId: "org-harborline",
      from: "2026-08-10T10:30:00.000Z",
      to: "2026-08-10T11:30:00.000Z",
      page: 1,
      pageSize: 25,
    });

    expect(page.items.map((event) => event.action)).toEqual([
      "verification.failed",
    ]);
  });

  it("returns correct pagination metadata and total", () => {
    const repository = createAuditEventRepository(database);
    const page = repository.list({
      organizationId: "org-harborline",
      page: 2,
      pageSize: 2,
    });

    expect(page).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(page.items.map((event) => event.details.position)).toEqual([3]);
  });

  it("returns an empty page when no rows match", () => {
    const repository = createAuditEventRepository(database);
    expect(
      repository.list({
        organizationId: "org-harborline",
        entityType: "report",
        page: 1,
        pageSize: 25,
      }),
    ).toEqual({ items: [], page: 1, pageSize: 25, total: 0 });
  });

  it("rejects invalid pagination values instead of producing broken SQL", () => {
    const repository = createAuditEventRepository(database);
    expect(() =>
      repository.list({
        organizationId: "org-harborline",
        page: 0,
        pageSize: 25,
      }),
    ).toThrow(/page/);
    expect(() =>
      repository.list({
        organizationId: "org-harborline",
        page: 1,
        pageSize: 0,
      }),
    ).toThrow(/pageSize/);
  });

  it("appends events without exposing update or delete behavior", () => {
    const repository = createAuditEventRepository(database);
    repository.append({
      organizationId: "org-harborline",
      actorType: "operator",
      actorId: "local-user",
      action: "report.generated",
      entityType: "report",
      entityId: "report-1",
      details: { period: "August" },
      occurredAt: "2026-08-10T13:00:00.000Z",
    });

    const page = repository.list({
      organizationId: "org-harborline",
      entityType: "report",
      page: 1,
      pageSize: 25,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.details).toEqual({ period: "August" });
    expect("update" in repository).toBe(false);
    expect("delete" in repository).toBe(false);
  });
});
