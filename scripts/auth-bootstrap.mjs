import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { provisionInitialOwner } from "../apps/api/dist/authentication.js";
import { getApiConfig } from "../apps/api/dist/config.js";
import { applyMigrations, openRemedenceDatabase } from "@remedence/database";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]?.trim()) {
    throw new Error(
      "Usage: bun run auth:bootstrap --name <name> --email <email>",
    );
  }
  return process.argv[index + 1];
}

const password = process.env.REMEDENCE_BOOTSTRAP_PASSWORD;
delete process.env.REMEDENCE_BOOTSTRAP_PASSWORD;

let database;
try {
  const config = getApiConfig();
  if (config.authentication.mode !== "required") {
    throw new Error(
      "REMEDENCE_AUTH_MODE=required is required for owner bootstrap.",
    );
  }
  if (!password) {
    throw new Error("REMEDENCE_BOOTSTRAP_PASSWORD is required.");
  }

  await mkdir(config.dataDirectory, { recursive: true });
  database = openRemedenceDatabase({ path: config.databasePath });
  applyMigrations(
    database,
    join(process.cwd(), "packages", "database", "migrations"),
  );
  await provisionInitialOwner(database, config.authentication, {
    name: argumentValue("--name"),
    email: argumentValue("--email"),
    password,
  });
  console.log("Initial Remedence owner provisioned; sign in to continue.");
} catch (error) {
  const allowed = new Set([
    "Usage: bun run auth:bootstrap --name <name> --email <email>",
    "REMEDENCE_AUTH_MODE=required is required for owner bootstrap.",
    "REMEDENCE_BOOTSTRAP_PASSWORD is required.",
    "Initial owner bootstrap requires an empty user table.",
    "Initial owner requires a name, email, and password of at least 12 characters.",
  ]);
  console.error(
    error instanceof Error && allowed.has(error.message)
      ? error.message
      : "Initial owner provisioning failed.",
  );
  process.exitCode = 1;
} finally {
  database?.close();
}
