import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { restoreDatabaseBackup } from "@remedence/database";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationsDirectory = resolve(
  repositoryRoot,
  "packages",
  "database",
  "migrations",
);

function option(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a file path.`);
  }
  return resolve(value);
}

const input = option("--input");
const output = option("--output");

restoreDatabaseBackup(input, output, migrationsDirectory);
console.log(`Validated database backup restored to ${output}`);
