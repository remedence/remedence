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
import { createCompanyRepository } from "../src/repositories/company-repository.js";

const migrationsDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

let temporaryDirectory: string;
let database: RemedenceDatabase;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(
    join(tmpdir(), "remedence-company-repository-"),
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

  const insertCompany = connection.prepare(
    `INSERT INTO companies (
       id, organization_id, name, risk_score, risk_level, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insertCompany.run(
    "company-zeta",
    "org-harborline",
    "Zeta Legal",
    62,
    "High",
    "2026-08-02T00:00:00.000Z",
    "2026-08-02T00:00:00.000Z",
  );
  insertCompany.run(
    "company-alpha",
    "org-harborline",
    "Alpha Health",
    35,
    "Medium",
    "2026-08-02T00:00:00.000Z",
    "2026-08-02T00:00:00.000Z",
  );
  insertCompany.run(
    "company-other",
    "org-other",
    "Other Company",
    10,
    "Low",
    "2026-08-02T00:00:00.000Z",
    "2026-08-02T00:00:00.000Z",
  );
});

afterEach(() => {
  database.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("CompanyRepository", () => {
  it("gets a company only inside the requested organization", () => {
    const repository = createCompanyRepository(database);

    expect(repository.getById("org-harborline", "company-alpha")).toMatchObject(
      {
        id: "company-alpha",
        organizationId: "org-harborline",
        name: "Alpha Health",
      },
    );
    expect(repository.getById("org-other", "company-alpha")).toBeUndefined();
  });

  it("returns undefined for an unknown company", () => {
    const repository = createCompanyRepository(database);
    expect(
      repository.getById("org-harborline", "company-missing"),
    ).toBeUndefined();
  });

  it("lists only the requested organization's companies", () => {
    const repository = createCompanyRepository(database);

    expect(
      repository.list("org-harborline").map((company) => company.id),
    ).toEqual(["company-alpha", "company-zeta"]);
  });

  it("orders company lists deterministically by name then id", () => {
    const connection = getDatabaseConnection(database);
    connection
      .prepare(
        `INSERT INTO companies (
           id, organization_id, name, risk_score, risk_level, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "company-alpha-2",
        "org-harborline",
        "Alpha Health",
        36,
        "Medium",
        "2026-08-03T00:00:00.000Z",
        "2026-08-03T00:00:00.000Z",
      );

    const repository = createCompanyRepository(database);
    expect(
      repository.list("org-harborline").map((company) => company.id),
    ).toEqual(["company-alpha", "company-alpha-2", "company-zeta"]);
  });

  it("implements the port's minimal safe insert operation", () => {
    const repository = createCompanyRepository(database);
    repository.insert({
      id: "company-new",
      organizationId: "org-harborline",
      name: "New Company",
      riskScore: 44,
      riskLevel: "Medium",
      createdAt: "2026-08-04T00:00:00.000Z",
      updatedAt: "2026-08-04T00:00:00.000Z",
    });

    expect(repository.getById("org-harborline", "company-new")).toMatchObject({
      id: "company-new",
      name: "New Company",
    });
  });
});
