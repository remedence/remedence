import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
  createIdempotencyStore,
  createIntegrationStore,
  createPostgresIdempotencyStore,
  createPostgresIntegrationStore,
  createPostgresPrivacyStore,
  createPostgresRateLimitStore,
  createPostgresRepositorySet,
  createPostgresUnitOfWork,
  createPostgresVerificationJobQueue,
  createPrivacyStore,
  createRepositorySet,
  createRateLimitStore,
  createUnitOfWork,
  createVerificationJobQueue,
  getDatabaseConnection,
  openRemedenceDatabase,
  openPostgresDatabase,
  seedHarborline,
  type RemedenceDatabase,
  type IdempotencyStore,
  type IntegrationStore,
  type PrivacyStore,
  type PostgresDatabase,
  type RateLimitStore,
} from "@remedence/database";
import type {
  VerificationExecutionProfile,
  VerificationJobQueue,
} from "@remedence/verification";
import { runTransaction } from "@remedence/database";
import {
  ClamAvMalwareScanner,
  hashEvidenceMetadata,
  LocalDevelopmentMalwareScanner,
  LocalEvidenceObjectStore,
  signEvidenceManifest,
  type EvidenceObjectStore,
  type MalwareScanner,
} from "@remedence/evidence";
import {
  createAuthentication,
  createPostgresAuthentication,
  type RemedenceAuthentication,
} from "./authentication.js";
import type { AuthenticationConfig, EvidenceSecurityConfig } from "./config.js";
import {
  IntegrationCredentialProtector,
  parseIntegrationKeyring,
  type IntegrationKeyring,
} from "./integration-runtime.js";

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
  rateLimit?: RateLimitStore;
  idempotency?: IdempotencyStore;
  verificationExecution?: {
    queue: VerificationJobQueue;
    profiles: ReadonlyMap<string, VerificationExecutionProfile>;
    queuedOnly: boolean;
  };
  integrations: {
    store: IntegrationStore;
    credentials: IntegrationCredentialProtector;
  };
  privacy: PrivacyStore;
  runAtomically?: <T>(operation: () => T | Promise<T>) => Promise<T>;
  evidenceProtection: {
    objectStore: EvidenceObjectStore;
    scanner: MalwareScanner;
    signingKey: string;
    retentionDays: number;
    clock: Clock;
    idGenerator: IdGenerator;
  };
  localOrganizationId: string;
  workspace: {
    status: () => DependencyResult<{
      initialized: boolean;
      mode: "empty" | "demo" | null;
      organization: { id: string; name: string; slug: string } | null;
    }>;
    initialize: (input: {
      mode: "empty" | "demo";
      organizationName?: string;
      organizationSlug?: string;
    }) => DependencyResult<{ id: string; name: string; slug: string }>;
  };
  health: () => DependencyResult<{
    database: "ready" | "degraded";
    schemaVersion: number;
  }>;
  log: (entry: Record<string, unknown>) => void;
}

export interface ApiDependencyConfig {
  databasePath: string;
  databaseUrl?: string;
  clock?: Clock;
  idGenerator?: IdGenerator;
  referenceTime?: string;
  log?: (entry: Record<string, unknown>) => void;
  authentication?: AuthenticationConfig;
  localOrganizationId?: string;
  workspaceMode?: "empty" | "demo";
  evidence?: EvidenceSecurityConfig;
  verificationProfiles?: readonly VerificationExecutionProfile[];
  integrationKeyring?: IntegrationKeyring;
  evidenceObjectStore?: EvidenceObjectStore;
  malwareScanner?: MalwareScanner;
}

type DependencyResult<T> = T | Promise<T>;

const databases = new WeakMap<ApiDependencies, RemedenceDatabase>();
const postgresDatabases = new WeakMap<ApiDependencies, PostgresDatabase>();

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

function localSigningKey(databasePath: string): string {
  const path = join(dirname(databasePath), "evidence-signing.key");
  if (!existsSync(path)) {
    writeFileSync(path, randomBytes(32).toString("hex"), {
      flag: "wx",
      mode: 0o600,
    });
  }
  const key = readFileSync(path, "utf8").trim();
  if (key.length < 32) throw new Error("Evidence signing key is invalid.");
  return key;
}

function localIntegrationKeyring(databasePath: string): IntegrationKeyring {
  const path = join(dirname(databasePath), "integration-encryption.key");
  if (!existsSync(path)) {
    writeFileSync(path, `1:${randomBytes(32).toString("base64")}`, {
      flag: "wx",
      mode: 0o600,
    });
  }
  return parseIntegrationKeyring(readFileSync(path, "utf8").trim());
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
    const evidenceConfig = config.evidence ?? { scanner: "local" };
    const signingKey =
      evidenceConfig.signingKey ?? localSigningKey(config.databasePath);
    const malwareScanner =
      config.malwareScanner ??
      (evidenceConfig.scanner === "clamav"
        ? new ClamAvMalwareScanner(evidenceConfig.host, evidenceConfig.port)
        : new LocalDevelopmentMalwareScanner());
    const evidenceObjectStore =
      config.evidenceObjectStore ??
      new LocalEvidenceObjectStore(
        join(dirname(config.databasePath), "evidence-objects"),
      );
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
          signEvidenceManifest: (manifest) =>
            signEvidenceManifest(manifest, signingKey),
        }),
        reports: new ReportService({ unitOfWork, clock, idGenerator }),
      },
      repositories,
      rateLimit: createRateLimitStore(database),
      idempotency: createIdempotencyStore(database),
      integrations: {
        store: createIntegrationStore(database),
        credentials: new IntegrationCredentialProtector(
          config.integrationKeyring ??
            localIntegrationKeyring(config.databasePath),
        ),
      },
      privacy: createPrivacyStore(database),
      verificationExecution: {
        queue: createVerificationJobQueue(database),
        profiles: new Map(
          (config.verificationProfiles ?? []).map((profile) => [
            profile.id,
            profile,
          ]),
        ),
        queuedOnly:
          config.authentication?.mode === "required" &&
          config.authentication.baseURL.startsWith("https://"),
      },
      runAtomically: (operation) =>
        runTransaction(database, async () => operation()),
      evidenceProtection: {
        objectStore: evidenceObjectStore,
        scanner: malwareScanner,
        signingKey,
        retentionDays: 365,
        clock,
        idGenerator,
      },
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

async function createPostgresDependencies(
  config: ApiDependencyConfig & { databaseUrl: string },
): Promise<ApiDependencies> {
  if (config.workspaceMode === "demo") {
    throw new Error(
      "PostgreSQL workspaces must be initialized explicitly; demo seeding is local SQLite only.",
    );
  }
  const database = openPostgresDatabase({
    connectionString: config.databaseUrl,
  });
  try {
    const schemaVersion = await database.loadSchemaVersion();
    if (schemaVersion !== 1) {
      throw new Error(
        `PostgreSQL schema version ${schemaVersion} is not supported; run the controlled migration job.`,
      );
    }
    const clock = config.clock ?? systemClock();
    const referenceTime = config.referenceTime ?? (() => clock.now());
    const repositories = createPostgresRepositorySet(database, {
      referenceTime,
    });
    const unitOfWork = createPostgresUnitOfWork(database, { referenceTime });
    const idGenerator = config.idGenerator ?? uuidGenerator();
    const evidenceConfig = config.evidence ?? { scanner: "local" };
    const signingKey =
      evidenceConfig.signingKey ?? localSigningKey(config.databasePath);
    const malwareScanner =
      config.malwareScanner ??
      (evidenceConfig.scanner === "clamav"
        ? new ClamAvMalwareScanner(evidenceConfig.host, evidenceConfig.port)
        : new LocalDevelopmentMalwareScanner());
    const evidenceObjectStore =
      config.evidenceObjectStore ??
      new LocalEvidenceObjectStore(
        join(dirname(config.databasePath), "evidence-objects"),
      );
    const localOrganizationId =
      config.localOrganizationId ?? EMPTY_LOCAL_ORGANIZATION_ID;
    const workspaceStatus = async () => {
      const result = await database.query<{
        id: string;
        name: string;
        slug: string;
      }>(
        `SELECT id, name, slug FROM remedence_organizations
         ORDER BY id LIMIT 2`,
      );
      const organization = result.rows.length === 1 ? result.rows[0]! : null;
      return {
        initialized: organization !== null,
        mode: organization ? ("empty" as const) : null,
        organization,
      };
    };
    const dependencies: ApiDependencies = {
      authentication: createPostgresAuthentication(
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
          signEvidenceManifest: (manifest) =>
            signEvidenceManifest(manifest, signingKey),
        }),
        reports: new ReportService({ unitOfWork, clock, idGenerator }),
      },
      repositories,
      rateLimit: createPostgresRateLimitStore(database),
      idempotency: createPostgresIdempotencyStore(database),
      integrations: {
        store: createPostgresIntegrationStore(database),
        credentials: new IntegrationCredentialProtector(
          config.integrationKeyring ??
            localIntegrationKeyring(config.databasePath),
        ),
      },
      privacy: createPostgresPrivacyStore(database),
      verificationExecution: {
        queue: createPostgresVerificationJobQueue(database),
        profiles: new Map(
          (config.verificationProfiles ?? []).map((profile) => [
            profile.id,
            profile,
          ]),
        ),
        queuedOnly:
          config.authentication?.mode === "required" &&
          config.authentication.baseURL.startsWith("https://"),
      },
      runAtomically: (operation) => database.transaction(operation),
      evidenceProtection: {
        objectStore: evidenceObjectStore,
        scanner: malwareScanner,
        signingKey,
        retentionDays: 365,
        clock,
        idGenerator,
      },
      localOrganizationId,
      workspace: {
        status: workspaceStatus,
        async initialize(input) {
          if ((await workspaceStatus()).initialized) {
            throw new Error("Workspace is already initialized.");
          }
          if (input.mode === "demo") {
            throw new Error("Demo seeding is unavailable for PostgreSQL.");
          }
          const name = input.organizationName?.trim() ?? "";
          const slug =
            input.organizationSlug?.trim().toLocaleLowerCase("en-US") ?? "";
          if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
            throw new Error("A workspace name and URL-safe slug are required.");
          }
          const now = clock.now();
          await database.query(
            `INSERT INTO remedence_organizations
               (id, name, slug, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $4)`,
            [localOrganizationId, name, slug, now],
          );
          return { id: localOrganizationId, name, slug };
        },
      },
      health: async () => {
        try {
          return {
            database: (await database.probe()) ? "ready" : "degraded",
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
    postgresDatabases.set(dependencies, database);
    return dependencies;
  } catch (error) {
    await database.close();
    throw error;
  }
}

export function createRuntimeDependencies(
  config: ApiDependencyConfig,
): ApiDependencies | Promise<ApiDependencies> {
  return config.databaseUrl
    ? createPostgresDependencies(
        config as ApiDependencyConfig & { databaseUrl: string },
      )
    : createDependencies(config);
}

export function closeDependencies(
  dependencies: ApiDependencies,
): void | Promise<void> {
  const postgres = postgresDatabases.get(dependencies);
  if (postgres) {
    postgresDatabases.delete(dependencies);
    return postgres.close();
  }
  const database = databases.get(dependencies);
  if (!database) return;
  database.close();
  databases.delete(dependencies);
}
