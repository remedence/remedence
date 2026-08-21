import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
import { seedHarborline } from "../src/seed.js";
import { createRepositorySet } from "../src/unit-of-work.js";

const migrationsDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
const referenceTime = "2026-08-20T12:00:00.000Z";
const organizationId = "org-harborline";

let temporaryDirectory: string;
let source: RemedenceDatabase;
let sourcePath: string;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "remedence-task13-backup-"));
  sourcePath = join(temporaryDirectory, "source", "remedence.db");
  mkdirSync(join(temporaryDirectory, "source"), { recursive: true });
  source = openRemedenceDatabase({ path: sourcePath });
  applyMigrations(source, migrationsDirectory);
  seedHarborline(source, { clock: { now: () => referenceTime } });
});

afterEach(() => {
  source.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("Task 13 SQLite backup", () => {
  it("creates a readable SQLite backup including Harborline and SEC-1042", async () => {
    const sourceRepositories = createRepositorySet(source, { referenceTime });
    expect(sourceRepositories.companies.list(organizationId)).toHaveLength(12);
    expect(
      sourceRepositories.findings.findByKey(organizationId, "SEC-1042")
        ?.findingKey,
    ).toBe("SEC-1042");

    const destination = join(
      temporaryDirectory,
      "nested",
      "backups",
      "remedence-backup.db",
    );
    await backupDatabase(source, destination);

    expect(existsSync(destination)).toBe(true);

    const backup = openRemedenceDatabase({ path: destination, readOnly: true });
    try {
      const repositories = createRepositorySet(backup, { referenceTime });
      expect(
        repositories.companies
          .list(organizationId)
          .some((company) => company.name === "Juniper Ridge Dental"),
      ).toBe(true);
      expect(
        repositories.findings.findByKey(organizationId, "SEC-1042"),
      ).toMatchObject({
        findingKey: "SEC-1042",
        companyId: "company-juniper-ridge-dental",
      });
    } finally {
      backup.close();
    }
  });

  it("rejects a destination resolving to the live source database", async () => {
    await expect(
      backupDatabase(
        source,
        join(temporaryDirectory, "source", ".", "remedence.db"),
      ),
    ).rejects.toThrow(
      "Backup destination must differ from the live database path.",
    );
  });

  it("refuses to overwrite an existing destination file", async () => {
    const destination = join(temporaryDirectory, "existing.db");
    writeFileSync(destination, "do-not-overwrite", "utf8");

    await expect(backupDatabase(source, destination)).rejects.toThrow(
      "Backup destination already exists.",
    );
    expect(readFileSync(destination, "utf8")).toBe("do-not-overwrite");
  });
});
