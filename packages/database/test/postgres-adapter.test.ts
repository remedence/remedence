import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { ImportFindingService } from "@remedence/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPostgresIdempotencyStore,
  createPostgresPrivacyStore,
  createPostgresRepositorySet,
  createPostgresUnitOfWork,
  createPostgresVerificationJobQueue,
  openPostgresDatabase,
  type PostgresDatabase,
} from "../src/index.js";

const now = "2026-08-23T12:00:00.000Z";
const organizationId = "org-postgres-test";

let pglite: PGlite | undefined;
let server: PGLiteSocketServer | undefined;
let database: PostgresDatabase;

beforeEach(async () => {
  const externalUrl = process.env.REMEDENCE_TEST_POSTGRES_URL;
  if (externalUrl) {
    database = openPostgresDatabase({
      connectionString: externalUrl,
      maxConnections: 4,
    });
    await database.query("DROP SCHEMA public CASCADE");
    await database.query("CREATE SCHEMA public");
  } else {
    pglite = await PGlite.create();
    server = new PGLiteSocketServer({
      db: pglite,
      host: "127.0.0.1",
      port: 0,
      maxConnections: 8,
    });
    await server.start();
    const serverConnection = server.getServerConn();
    database = openPostgresDatabase({
      connectionString: serverConnection.startsWith("postgres")
        ? serverConnection
        : `postgresql://postgres@${serverConnection}/postgres`,
      maxConnections: 4,
    });
  }
  await database.migrate();
  await database.query(
    `INSERT INTO remedence_organizations
       (id, name, slug, created_at, updated_at)
     VALUES ($1, 'Postgres Test', 'postgres-test', $2, $2)`,
    [organizationId, now],
  );
});

afterEach(async () => {
  await database?.close();
  await server?.stop();
  await pglite?.close();
  server = undefined;
  pglite = undefined;
});

describe("pooled PostgreSQL production adapter", () => {
  it("migrates, persists tenant-scoped domain work, and rolls back atomically", async () => {
    const repositories = createPostgresRepositorySet(database, {
      referenceTime: now,
    });
    await repositories.companies.insert({
      organizationId,
      id: "company-one",
      name: "Company One",
      riskScore: 42,
      riskLevel: "Medium",
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    const service = new ImportFindingService({
      unitOfWork: createPostgresUnitOfWork(database, { referenceTime: now }),
      clock: { now: () => now },
      idGenerator: {
        next: (() => {
          const ids = ["finding-one", "import-one"];
          return () => ids.shift()!;
        })(),
      },
    });
    const imported = await service.importFinding({
      organizationId,
      companyId: "company-one",
      findingKey: " pg-100 ",
      title: "PostgreSQL persistence",
      description: "Exercise the production repository transaction.",
      source: "Test",
      severity: "High",
      owner: "Owner",
      assetName: "API",
      detectedAt: now,
      slaDueAt: "2026-08-30T12:00:00.000Z",
      actor: { actorType: "test", actorId: "test-user" },
    });
    expect(imported.finding.findingKey).toBe("PG-100");
    expect(
      await repositories.findings.findByKey(organizationId, "pg-100"),
    ).toMatchObject({ id: "finding-one", organizationId });

    await repositories.findings.insert({
      ...imported.finding,
      id: "finding-two",
      findingKey: "PG-200",
      detectedAt: "2026-08-22T12:00:00.000Z",
      createdAt: "2026-08-22T12:00:00.000Z",
    });
    const firstPage = await repositories.findings.list({
      organizationId,
      sort: "newest",
      includeVerified: true,
      pageSize: 1,
    });
    expect(firstPage.items.map((finding) => finding.findingKey)).toEqual([
      "PG-100",
    ]);
    expect(firstPage.total).toBe(2);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await repositories.findings.list({
      organizationId,
      sort: "newest",
      includeVerified: true,
      pageSize: 1,
      cursor: firstPage.nextCursor!,
    });
    expect(secondPage.items.map((finding) => finding.findingKey)).toEqual([
      "PG-200",
    ]);
    expect(secondPage.nextCursor).toBeNull();
    for (const sort of ["priority", "sla"] as const) {
      const pageOne = await repositories.findings.list({
        organizationId,
        sort,
        includeVerified: true,
        pageSize: 1,
      });
      const pageTwo = await repositories.findings.list({
        organizationId,
        sort,
        includeVerified: true,
        pageSize: 1,
        cursor: pageOne.nextCursor!,
      });
      expect(
        new Set([...pageOne.items, ...pageTwo.items].map((item) => item.id)),
      ).toEqual(new Set(["finding-one", "finding-two"]));
      expect(pageTwo.nextCursor).toBeNull();
    }

    const otherOrganizationId = "org-postgres-other";
    await database.query(
      `INSERT INTO remedence_organizations
         (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Other Tenant', 'other-tenant', $2, $2)`,
      [otherOrganizationId, now],
    );
    await repositories.companies.insert({
      organizationId: otherOrganizationId,
      id: "company-one",
      name: "Other Company",
      riskScore: 1,
      riskLevel: "Low",
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    await repositories.findings.insert({
      ...imported.finding,
      organizationId: otherOrganizationId,
    });
    expect(
      await repositories.findings.findByKey(otherOrganizationId, "PG-100"),
    ).toMatchObject({ id: "finding-one", organizationId: otherOrganizationId });
    expect(
      await repositories.findings.list({
        organizationId: otherOrganizationId,
        sort: "newest",
        includeVerified: true,
        pageSize: 10,
      }),
    ).toMatchObject({ total: 1 });

    await expect(
      database.transaction(async () => {
        await repositories.companies.insert({
          organizationId,
          id: "company-rollback",
          name: "Rollback",
          riskScore: 0,
          riskLevel: "Low",
          createdAt: now,
          updatedAt: now,
          version: 1,
        });
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");
    expect(
      await repositories.companies.getById(organizationId, "company-rollback"),
    ).toBeUndefined();
  });

  it("coordinates idempotency and queue claims across pooled clients", async () => {
    const idempotency = createPostgresIdempotencyStore(database);
    const scope = {
      organizationId,
      actorId: "actor-one",
      key: "request-key-one",
      operation: "POST /findings",
      requestHash: "a".repeat(64),
    };
    const reservations = await Promise.all([
      idempotency.begin(scope, now, "2026-08-24T12:00:00.000Z"),
      idempotency.begin(scope, now, "2026-08-24T12:00:00.000Z"),
    ]);
    expect(reservations.map((item) => item.outcome).sort()).toEqual([
      "in-progress",
      "reserved",
    ]);

    const queue = createPostgresVerificationJobQueue(database);
    for (const id of ["job-one", "job-two"]) {
      await queue.enqueue({
        organizationId,
        id,
        verificationId: `verification-${id}`,
        profileId: "profile-one",
        status: "Queued",
        attempt: 0,
        maxAttempts: 2,
        timeoutSeconds: 60,
        availableAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        cancellationRequested: false,
        lastError: "",
        createdAt: now,
        updatedAt: now,
      });
    }
    const claims = await Promise.all([
      queue.claim({
        workerId: "worker-one",
        now,
        leaseExpiresAt: "2026-08-23T12:01:00.000Z",
      }),
      queue.claim({
        workerId: "worker-two",
        now,
        leaseExpiresAt: "2026-08-23T12:01:00.000Z",
      }),
    ]);
    expect(new Set(claims.map((claim) => claim?.id)).size).toBe(2);
    expect(claims.map((claim) => claim?.status)).toEqual([
      "Running",
      "Running",
    ]);
  });

  it("removes tenant-only accounts while preserving shared identities", async () => {
    await database.query(
      `INSERT INTO remedence_organizations
         (id, name, slug, created_at, updated_at)
       VALUES ('org-shared', 'Shared Tenant', 'shared-tenant', $1, $1)`,
      [now],
    );
    for (const [id, email] of [
      ["user-orphan", "orphan@example.test"],
      ["user-shared", "shared@example.test"],
    ]) {
      await database.query(
        `INSERT INTO "user"
           ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
         VALUES ($1, $1, $2, true, $3, $3)`,
        [id, email, now],
      );
      await database.query(
        `INSERT INTO organization_memberships
           (organization_id, user_id, role, status, created_at, updated_at)
         VALUES ($1, $2, 'Owner', 'Active', $3, $3)`,
        [organizationId, id, now],
      );
    }
    await database.query(
      `INSERT INTO organization_memberships
         (organization_id, user_id, role, status, created_at, updated_at)
       VALUES ('org-shared', 'user-shared', 'Member', 'Active', $1, $1)`,
      [now],
    );

    const receipt = await createPostgresPrivacyStore(database).deleteTenant({
      organizationId,
      receiptId: "delete-postgres-tenant",
      requestedBy: "user-orphan",
      now,
    });
    expect(receipt.status).toBe("Pending object cleanup");
    const users = await database.query<{ id: string }>(
      `SELECT id FROM "user" ORDER BY id`,
    );
    expect(users.rows.map((row) => row.id)).toEqual(["user-shared"]);
    expect(
      await database.query(
        "SELECT id FROM remedence_organizations WHERE id = $1",
        [organizationId],
      ),
    ).toMatchObject({ rowCount: 0 });
  });
});
