import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DashboardService,
  ImportFindingService,
  RemediationService,
  ReportService,
  VerificationService,
  type Clock,
  type IdGenerator,
  type RepositorySet,
} from "@remedence/core";
import {
  applyMigrations,
  createRepositorySet,
  createUnitOfWork,
  getDatabaseConnection,
  openRemedenceDatabase,
  seedHarborline,
  type RemedenceDatabase,
} from "@remedence/database";
import { hashEvidenceMetadata } from "@remedence/evidence";
import {
  createAuthentication,
  type RemedenceAuthentication,
} from "./authentication.js";
import type { AuthenticationConfig } from "./config.js";

export const DEFAULT_LOCAL_ORGANIZATION_ID = "org-harborline";
export const EMPTY_LOCAL_ORGANIZATION_ID = "org-local-workspace";

const migrationsDirectory = fileURLToPath(
  new URL("../../../packages/database/migrations", import.meta.url),
);

export interface ApiDependencies {
  authentication?: RemedenceAuthentication | null;
  services: {
    dashboard: DashboardService;
    imports: ImportFindingService;
    remediation: RemediationService;
    verification: VerificationService;
    reports: ReportService;
  };
  repositories: RepositorySet;
  localOrganizationId: string;
  workspace: {
    status: () => {
      initialized: boolean;
      mode: "empty" | "demo" | null;
      organization: { id: string; name: string; slug: string } | null;
    };
    initialize: (input: {
      mode: "empty" | "demo";
      organizationName?: string;
      organizationSlug?: string;
    }) => { id: string; name: string; slug: string };
  };
  health: () => {
    database: "ready" | "degraded";
    schemaVersion: number;
  };
  log: (entry: Record<string, unknown>) => void;
}

export interface ApiDependencyConfig {
  databasePath: string;
  clock?: Clock;
  idGenerator?: IdGenerator;
  referenceTime?: string;
  log?: (entry: Record<string, unknown>) => void;
  authentication?: AuthenticationConfig;
  localOrganizationId?: string;
  workspaceMode?: "empty" | "demo";
}

const databases = new WeakMap<ApiDependencies, RemedenceDatabase>();

function systemClock(): Clock {
  return {
    now: () => new Date().toISOString(),
  };
}

function uuidGenerator(): IdGenerator {
  return {
    next: () => randomUUID(),
  };
}

function structuredConsoleLog(entry: Record<string, unknown>): void {
  console.log(JSON.stringify(entry));
}

export function createDependencies(
  config: ApiDependencyConfig,
): ApiDependencies {
  mkdirSync(dirname(config.databasePath), { recursive: true });

  const database = openRemedenceDatabase({ path: config.databasePath });
  try {
    applyMigrations(database, migrationsDirectory);

    const clock = config.clock ?? systemClock();
    const seedReferenceTime = config.referenceTime ?? clock.now();
    if (config.workspaceMode === "demo") {
      seedHarborline(database, {
        clock: {
          now: () => seedReferenceTime,
        },
      });
    }

    const referenceTime = config.referenceTime ?? (() => clock.now());
    const repositories = createRepositorySet(database, { referenceTime });
    const unitOfWork = createUnitOfWork(database, { referenceTime });
    const idGenerator = config.idGenerator ?? uuidGenerator();
    const databaseProbe = getDatabaseConnection(database).prepare(
      "SELECT 1 AS responsive",
    );

    const localOrganizationId =
      config.localOrganizationId ??
      (config.workspaceMode === "demo"
        ? DEFAULT_LOCAL_ORGANIZATION_ID
        : EMPTY_LOCAL_ORGANIZATION_ID);
    const workspaceStatus = () => {
      const organizations = getDatabaseConnection(database)
        .prepare(
          `SELECT id, name, slug
           FROM organizations
           ORDER BY id
           LIMIT 2`,
        )
        .all() as unknown as Array<{ id: string; name: string; slug: string }>;
      const organization =
        organizations.length === 1 ? organizations[0]! : null;
      return {
        initialized: organization !== null,
        mode:
          organization?.id === DEFAULT_LOCAL_ORGANIZATION_ID
            ? ("demo" as const)
            : organization
              ? ("empty" as const)
              : null,
        organization,
      };
    };

    const dependencies: ApiDependencies = {
      authentication: createAuthentication(
        database,
        config.authentication ?? { mode: "local" },
      ),
      services: {
        dashboard: new DashboardService({ repositories }),
        imports: new ImportFindingService({ unitOfWork, clock, idGenerator }),
        remediation: new RemediationService({ unitOfWork, clock, idGenerator }),
        verification: new VerificationService({
          unitOfWork,
          clock,
          idGenerator,
          hashEvidence: hashEvidenceMetadata,
        }),
        reports: new ReportService({ unitOfWork, clock, idGenerator }),
      },
      repositories,
      localOrganizationId,
      workspace: {
        status: workspaceStatus,
        initialize(input) {
          const current = workspaceStatus();
          if (current.initialized) {
            throw new Error("Workspace is already initialized.");
          }
          if (input.mode === "demo") {
            seedHarborline(database, {
              clock: { now: () => clock.now() },
            });
            return workspaceStatus().organization!;
          }

          const name = input.organizationName?.trim() ?? "";
          const slug =
            input.organizationSlug?.trim().toLocaleLowerCase("en-US") ?? "";
          if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
            throw new Error("A workspace name and URL-safe slug are required.");
          }
          const now = clock.now();
          getDatabaseConnection(database)
            .prepare(
              `INSERT INTO organizations (id, name, slug, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .run(localOrganizationId, name, slug, now, now);
          return workspaceStatus().organization!;
        },
      },
      health: () => {
        try {
          const result = databaseProbe.get() as { responsive?: unknown };
          return {
            database: result.responsive === 1 ? "ready" : "degraded",
            schemaVersion: database.schemaVersion,
          };
        } catch {
          return {
            database: "degraded",
            schemaVersion: database.schemaVersion,
          };
        }
      },
      log: config.log ?? structuredConsoleLog,
    };

    databases.set(dependencies, database);
    return dependencies;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function closeDependencies(dependencies: ApiDependencies): void {
  const database = databases.get(dependencies);
  if (!database) return;
  database.close();
  databases.delete(dependencies);
}
