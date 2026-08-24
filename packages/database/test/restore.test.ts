import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupDatabase } from "../src/backup.js";
import {
  openRemedenceDatabase,
  type RemedenceDatabase,
} from "../src/database.js";
import { applyMigrations } from "../src/migrations.js";
import { restoreDatabaseBackup } from "../src/restore.js";
import { seedHarborline } from "../src/seed.js";
import { createRepositorySet } from "../src/unit-of-work.js";

const migrationsDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
const referenceTime = "2026-08-20T12:00:00.000Z";
let temporaryDirectory: string;
let source: RemedenceDatabase;
let backupPath: string;

beforeEach(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "remedence-restore-"));
  const sourceDirectory = join(temporaryDirectory, "source");
  mkdirSync(sourceDirectory);
  source = openRemedenceDatabase({
    path: join(sourceDirectory, "remedence.db"),
  });
  applyMigrations(source, migrationsDirectory);
  seedHarborline(source, { clock: { now: () => referenceTime } });
  backupPath = join(temporaryDirectory, "backup.db");
  await backupDatabase(source, backupPath);
});

afterEach(() => {
  source.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("SQLite restore", () => {
  it("restores a validated backup to an absent destination", () => {
    const destination = join(temporaryDirectory, "restored.db");
    restoreDatabaseBackup(backupPath, destination, migrationsDirectory);

    const restored = openRemedenceDatabase({
      path: destination,
      readOnly: true,
    });
    try {
      expect(restored.schemaVersion).toBe(2);
      expect(
        createRepositorySet(restored, { referenceTime })
          .companies.list("org-harborline")
          .map((company) => company.name),
      ).toContain("Juniper Ridge Dental");
    } finally {
      restored.close();
    }
    expect(
      readdirSync(temporaryDirectory).filter((entry) =>
        entry.includes(".restore-"),
      ),
    ).toEqual([]);
  });

  it("rejects a corrupt backup without creating a destination", () => {
    const corrupt = join(temporaryDirectory, "corrupt.db");
    const destination = join(temporaryDirectory, "not-created.db");
    writeFileSync(corrupt, "not sqlite", "utf8");

    expect(() =>
      restoreDatabaseBackup(corrupt, destination, migrationsDirectory),
    ).toThrow();
    expect(existsSync(destination)).toBe(false);
  });

  it("never overwrites an existing restore destination", () => {
    const destination = join(temporaryDirectory, "existing.db");
    writeFileSync(destination, "preserve", "utf8");

    expect(() =>
      restoreDatabaseBackup(backupPath, destination, migrationsDirectory),
    ).toThrow("Restore destination already exists.");
    expect(readFileSync(destination, "utf8")).toBe("preserve");
    expect(
      readdirSync(temporaryDirectory).filter((entry) =>
        entry.includes(".restore-"),
      ),
    ).toEqual([]);
  });
});
