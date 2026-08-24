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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthentication } from "../src/authentication.js";

const migrationsDirectory = fileURLToPath(
  new URL("../../../packages/database/migrations", import.meta.url),
);
const baseURL = "http://127.0.0.1:43180";
const testSecret = "public-test-secret-not-for-production-000000000000";
const temporaryDirectories: string[] = [];
const databases: RemedenceDatabase[] = [];
let previousSecret: string | undefined;

beforeEach(() => {
  previousSecret = process.env.BETTER_AUTH_SECRET;
  process.env.BETTER_AUTH_SECRET = testSecret;
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = previousSecret;
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
