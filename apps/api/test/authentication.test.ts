import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMigrations,
  getDatabaseConnection,
  openRemedenceDatabase,
  type RemedenceDatabase,
} from "@remedence/database";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createAuthentication } from "../src/authentication.js";
import {
  closeDependencies,
  createDependencies,
  type ApiDependencies,
} from "../src/dependencies.js";

const migrationsDirectory = fileURLToPath(
  new URL("../../../packages/database/migrations", import.meta.url),
);
const baseURL = "http://127.0.0.1:43180";
const testSecret = "public-test-secret-not-for-production-000000000000";
const temporaryDirectories: string[] = [];
const databases: RemedenceDatabase[] = [];
const dependencySets: ApiDependencies[] = [];
let previousSecret: string | undefined;

beforeEach(() => {
  previousSecret = process.env.BETTER_AUTH_SECRET;
  process.env.BETTER_AUTH_SECRET = testSecret;
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = previousSecret;
  for (const dependencies of dependencySets.splice(0)) {
    closeDependencies(dependencies);
  }
  for (const database of databases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function openMigratedDatabase(): RemedenceDatabase {
  const directory = mkdtempSync(join(tmpdir(), "remedence-auth-"));
  temporaryDirectories.push(directory);
  const database = openRemedenceDatabase({
    path: join(directory, "remedence.db"),
  });
  databases.push(database);
  expect(applyMigrations(database, migrationsDirectory)).toBe(2);
  return database;
}

function signUpRequest(email: string): Request {
  return new Request(`${baseURL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseURL,
    },
    body: JSON.stringify({
      name: "Remedence Owner",
      email,
      password: "correct-horse-battery-staple",
    }),
  });
}

describe("Better Auth persistence", () => {
  it("mounts auth before JSON parsing and rejects anonymous product access", async () => {
    const directory = mkdtempSync(join(tmpdir(), "remedence-auth-app-"));
    temporaryDirectories.push(directory);
    const dependencies = createDependencies({
      databasePath: join(directory, "remedence.db"),
      authentication: { mode: "required", baseURL },
      log: () => undefined,
    });
    dependencySets.push(dependencies);
    const app = createApp(dependencies, {
      allowedMutationOrigins: [baseURL],
    });

    await request(app).get("/api/auth/ok").expect(200);
    await request(app).get("/livez").expect(200);
    const protectedResponse = await request(app)
      .get("/api/v1/companies")
      .expect(401);
    expect(protectedResponse.type).toBe("application/problem+json");
    expect(protectedResponse.body).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      detail: "A valid authenticated session is required.",
    });

    const enrollmentDatabase = openRemedenceDatabase({
      path: join(directory, "remedence.db"),
    });
    databases.push(enrollmentDatabase);
    const enrollmentAuthentication = createAuthentication(
      enrollmentDatabase,
      { mode: "required", baseURL },
      { allowPublicSignUp: true },
    );
    const enrollmentResponse = await enrollmentAuthentication!.handler(
      signUpRequest("integrated-owner@example.com"),
    );
    expect(enrollmentResponse.status).toBe(200);
    const cookie = enrollmentResponse.headers
      .get("set-cookie")
      ?.split(";", 1)[0];
    expect(cookie).toBeTruthy();

    await request(app)
      .get("/api/v1/companies")
      .set("Cookie", cookie!)
      .expect(200);
    await request(app)
      .post("/api/v1/imports")
      .set("Cookie", cookie!)
      .set("Origin", baseURL)
      .send({
        company_id: "company-juniper-ridge-dental",
        finding_key: "SEC-AUTH-ACTOR",
        title: "Authenticated actor audit test",
        description: "The persisted actor must come from the secure session.",
        source: "Authenticated test",
        severity: "High",
        owner: "Remedence Owner",
        asset_name: "Patient Portal API",
        detected_at: "2026-08-23T18:00:00.000Z",
        sla_due_at: "2026-08-24T18:00:00.000Z",
      })
      .expect(201);

    const auditActor = getDatabaseConnection(enrollmentDatabase)
      .prepare(
        `SELECT actor_type, actor_id
         FROM audit_events
         WHERE action = 'finding.imported'
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get() as { actor_type: string; actor_id: string };
    const session = await enrollmentAuthentication!.getSession(
      new Headers({ cookie: cookie! }),
    );
    expect(auditActor).toEqual({
      actor_type: "user",
      actor_id: session!.user.id,
    });
  });

  it("keeps public account creation disabled by default", async () => {
    const authentication = createAuthentication(openMigratedDatabase(), {
      mode: "required",
      baseURL,
    });
    expect(authentication).not.toBeNull();

    const response = await authentication!.handler(
      signUpRequest("blocked@example.com"),
    );

    expect(response.status).toBe(400);
    expect(
      getDatabaseConnection(databases[0]!)
        .prepare('SELECT COUNT(*) AS count FROM "user"')
        .get(),
    ).toMatchObject({ count: 0 });
  });

  it("persists a hashed credential and resolves its secure session", async () => {
    const database = openMigratedDatabase();
    const authentication = createAuthentication(
      database,
      { mode: "required", baseURL },
      { allowPublicSignUp: true },
    );
    expect(authentication).not.toBeNull();

    const response = await authentication!.handler(
      signUpRequest("owner@example.com"),
    );
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    const cookie = setCookie?.split(";", 1)[0];
    expect(cookie).toBeTruthy();

    const session = await authentication!.getSession(
      new Headers({ cookie: cookie! }),
    );
    expect(session?.user).toMatchObject({
      email: "owner@example.com",
      name: "Remedence Owner",
    });
    expect(session?.session.userId).toBe(session?.user.id);

    const account = getDatabaseConnection(database)
      .prepare('SELECT password FROM "account" WHERE "userId" = ?')
      .get(session!.user.id) as { password: string };
    expect(account.password).not.toContain("correct-horse-battery-staple");
  });
});
