import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMigrations,
  getDatabaseConnection,
  openRemedenceDatabase,
  seedHarborline,
  type RemedenceDatabase,
} from "@remedence/database";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import {
  createAuthentication,
  createAuthenticationOptions,
  provisionInitialOwner,
} from "../src/authentication.js";
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
  vi.restoreAllMocks();
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
  expect(applyMigrations(database, migrationsDirectory)).toBe(11);
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
  it("delivers password reset links through the configured authenticated webhook", async () => {
    const delivery = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));
    const options = createAuthenticationOptions(
      getDatabaseConnection(openMigratedDatabase()),
      {
        mode: "required",
        baseURL,
        passwordResetDelivery: {
          webhookURL: "https://mailer.example/reset",
          bearerToken: "delivery-test-token-00000000000000000000",
        },
      },
    );
    const send = options.emailAndPassword?.sendResetPassword;
    expect(send).toBeTypeOf("function");

    await send!(
      {
        user: {
          id: "user-owner",
          name: "Initial Owner",
          email: "owner@example.com",
          emailVerified: true,
          image: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        url: `${baseURL}/?token=one-time-value`,
        token: "one-time-value",
      },
      new Request(baseURL),
    );

    expect(delivery).toHaveBeenCalledOnce();
    const [url, requestOptions] = delivery.mock.calls[0]!;
    expect(url).toBe("https://mailer.example/reset");
    expect(requestOptions?.headers).toMatchObject({
      authorization: "Bearer delivery-test-token-00000000000000000000",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(requestOptions?.body))).toEqual({
      template: "password-reset",
      recipient: { email: "owner@example.com", name: "Initial Owner" },
      action_url: `${baseURL}/?token=one-time-value`,
      expires_in_seconds: 1800,
    });
  });

  it("provisions exactly one owner without retaining a bootstrap session", async () => {
    const database = openMigratedDatabase();
    seedHarborline(database, {
      clock: { now: () => "2026-08-23T12:00:00.000Z" },
    });
    const owner = await provisionInitialOwner(
      database,
      { mode: "required", baseURL },
      {
        name: " Initial Owner ",
        email: "OWNER@EXAMPLE.COM",
        password: "correct-horse-battery-staple",
      },
    );

    expect(owner.email).toBe("owner@example.com");
    const connection = getDatabaseConnection(database);
    expect(
      connection.prepare('SELECT COUNT(*) AS count FROM "user"').get(),
    ).toMatchObject({ count: 1 });
    expect(
      connection.prepare('SELECT COUNT(*) AS count FROM "session"').get(),
    ).toMatchObject({ count: 0 });
    expect(
      connection
        .prepare(
          `SELECT organization_id, role, status
           FROM organization_memberships
           WHERE user_id = ?`,
        )
        .get(owner.userId),
    ).toMatchObject({
      organization_id: "org-harborline",
      role: "Owner",
      status: "Active",
    });
    const account = connection
      .prepare('SELECT password FROM "account" WHERE "userId" = ?')
      .get(owner.userId) as { password: string };
    expect(account.password).not.toContain("correct-horse-battery-staple");

    await expect(
      provisionInitialOwner(
        database,
        { mode: "required", baseURL },
        {
          name: "Second Owner",
          email: "second@example.com",
          password: "another-correct-battery-staple",
        },
      ),
    ).rejects.toThrow("Initial owner bootstrap requires an empty user table.");
  });

  it("mounts auth before JSON parsing and rejects anonymous product access", async () => {
    const directory = mkdtempSync(join(tmpdir(), "remedence-auth-app-"));
    temporaryDirectories.push(directory);
    const dependencies = createDependencies({
      databasePath: join(directory, "remedence.db"),
      authentication: { mode: "required", baseURL },
      workspaceMode: "demo",
      log: () => undefined,
    });
    dependencySets.push(dependencies);
    const app = createApp(dependencies, {
      allowedMutationOrigins: [baseURL],
    });

    await request(app).get("/api/auth/ok").expect(200);
    await request(app).get("/livez").expect(200);
    expect(
      (await request(app).get("/api/auth/remedence-status").expect(200)).body,
    ).toEqual({
      mode: "required",
      authenticated: false,
      user: null,
      mfa: { required: false, enrolled: false },
      password_reset_enabled: false,
      federation_protocols: ["oidc", "saml"],
    });
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
    const enrolledUser = getDatabaseConnection(enrollmentDatabase)
      .prepare('SELECT id FROM "user" WHERE email = ?')
      .get("integrated-owner@example.com") as { id: string };
    expect(
      (
        await request(app)
          .get("/api/auth/remedence-status")
          .set("Cookie", cookie!)
          .expect(200)
      ).body,
    ).toMatchObject({
      mode: "required",
      authenticated: true,
      user: {
        name: "Remedence Owner",
        email: "integrated-owner@example.com",
      },
    });

    const noMembership = await request(app)
      .get("/api/v1/companies")
      .set("Cookie", cookie!)
      .expect(403);
    expect(noMembership.body).toMatchObject({
      code: "ORGANIZATION_ACCESS_REQUIRED",
    });

    getDatabaseConnection(enrollmentDatabase)
      .prepare(
        `INSERT INTO organization_memberships (
           organization_id, user_id, role, status, created_at, updated_at
         ) VALUES ('org-harborline', ?, 'Owner', 'Active', ?, ?)`,
      )
      .run(
        enrolledUser.id,
        "2026-08-23T12:00:00.000Z",
        "2026-08-23T12:00:00.000Z",
      );

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
