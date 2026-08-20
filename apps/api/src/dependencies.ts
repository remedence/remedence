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
  openRemedenceDatabase,
  seedHarborline,
  type RemedenceDatabase,
} from "@remedence/database";
import { hashEvidenceMetadata } from "@remedence/evidence";

export const LOCAL_ORGANIZATION_ID = "org-harborline";

const migrationsDirectory = fileURLToPath(
  new URL("../../../packages/database/migrations", import.meta.url),
);

export interface ApiDependencies {
  services: {
    dashboard: DashboardService;
    imports: ImportFindingService;
    remediation: RemediationService;
    verification: VerificationService;
    reports: ReportService;
  };
  repositories: RepositorySet;
  health: () => {
    database: "ready";
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
    const referenceTime = config.referenceTime ?? clock.now();
    seedHarborline(database, {
      clock: {
        now: () => referenceTime,
      },
    });

    const repositories = createRepositorySet(database, { referenceTime });
    const unitOfWork = createUnitOfWork(database, { referenceTime });
    const idGenerator = config.idGenerator ?? uuidGenerator();

    const dependencies: ApiDependencies = {
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
      health: () => ({
        database: "ready",
        schemaVersion: database.schemaVersion,
      }),
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
