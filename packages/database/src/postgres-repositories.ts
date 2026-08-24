import {
  DomainError,
  findingPriorityBucket,
  type AuditEvent,
  type Company,
  type CursorPage,
  type DashboardFinding,
  type EvidenceArtifact,
  type EvidenceItem,
  type Finding,
  type FindingDetail,
  type FindingQuery,
  type Remediation,
  type Report,
  type RepositorySet,
  type UnitOfWork,
  type VerificationCheck,
  type VerificationRun,
} from "@remedence/core";
import { decodeCursor, encodeCursor } from "./cursor.js";
import type { PostgresDatabase } from "./postgres-database.js";
import type { RepositorySetOptions } from "./unit-of-work.js";

type EntityType =
  | "company"
  | "finding"
  | "remediation"
  | "verification"
  | "verification-check"
  | "evidence"
  | "evidence-artifact"
  | "report";

interface EntityRow<T> {
  payload: T;
}

function referenceTime(options: RepositorySetOptions): string {
  const value =
    typeof options.referenceTime === "function"
      ? options.referenceTime()
      : options.referenceTime;
  if (new Date(value).toISOString() !== value) {
    throw new TypeError("referenceTime must be a canonical UTC timestamp.");
  }
  return value;
}

async function getEntity<T>(
  database: PostgresDatabase,
  organizationId: string,
  type: EntityType,
  id: string,
): Promise<T | undefined> {
  const result = await database.query<EntityRow<T>>(
    `SELECT payload FROM remedence_entities
     WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3`,
    [organizationId, type, id],
  );
  return result.rows[0]?.payload;
}

async function listEntities<T>(
  database: PostgresDatabase,
  organizationId: string,
  type: EntityType,
  predicateSql = "",
  parameters: readonly unknown[] = [],
  orderSql = "created_at ASC, entity_id ASC",
): Promise<T[]> {
  const result = await database.query<EntityRow<T>>(
    `SELECT payload FROM remedence_entities
     WHERE organization_id = $1 AND entity_type = $2 ${predicateSql}
     ORDER BY ${orderSql}`,
    [organizationId, type, ...parameters],
  );
  return result.rows.map((row) => row.payload);
}

async function insertEntity<T extends { organizationId: string; id: string }>(
  database: PostgresDatabase,
  type: EntityType,
  value: T,
  createdAt: string,
  updatedAt = createdAt,
): Promise<void> {
  await database.query(
    `INSERT INTO remedence_entities
       (organization_id, entity_type, entity_id, payload, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, $6::timestamptz)`,
    [
      value.organizationId,
      type,
      value.id,
      JSON.stringify(value),
      createdAt,
      updatedAt,
    ],
  );
}

function dashboardFinding(
  finding: Finding,
  company: Company,
  now: string,
): DashboardFinding {
  const slaBreached =
    finding.state !== "Verified fixed" && finding.slaDueAt < now;
  const result = {
    ...finding,
    companyName: company.name,
    slaBreached,
    priorityBucket: 0,
  };
  result.priorityBucket = findingPriorityBucket(result);
  return result;
}

function cursorValues(
  sort: FindingQuery["sort"],
  finding: DashboardFinding,
): Array<string | number> {
  if (sort === "priority") {
    return [
      finding.priorityBucket,
      finding.slaDueAt,
      finding.detectedAt,
      finding.findingKey,
    ];
  }
  if (sort === "newest") return [finding.detectedAt, finding.findingKey];
  return [finding.slaBreached ? 1 : 0, finding.slaDueAt, finding.findingKey];
}

export function createPostgresRepositorySet(
  database: PostgresDatabase,
  options: RepositorySetOptions,
): RepositorySet {
  const repositories: RepositorySet = {
    companies: {
      getById: (organizationId, id) =>
        getEntity<Company>(database, organizationId, "company", id),
      list: (organizationId) =>
        listEntities<Company>(
          database,
          organizationId,
          "company",
          "",
          [],
          "payload->>'name' ASC, entity_id ASC",
        ),
      insert: (company) =>
        insertEntity(
          database,
          "company",
          company,
          company.createdAt,
          company.updatedAt,
        ),
    },
    findings: {
      getById: (organizationId, id) =>
        getEntity<Finding>(database, organizationId, "finding", id),
      async findByKey(organizationId, findingKey) {
        const result = await database.query<EntityRow<Finding>>(
          `SELECT payload FROM remedence_entities
           WHERE organization_id = $1 AND entity_type = 'finding'
             AND upper(payload->>'findingKey') = upper($2)
           LIMIT 1`,
          [organizationId, findingKey],
        );
        return result.rows[0]?.payload;
      },
      async list(query): Promise<CursorPage<DashboardFinding>> {
        if (
          !Number.isSafeInteger(query.pageSize) ||
          query.pageSize < 1 ||
          query.pageSize > 100
        ) {
          throw new RangeError("pageSize must be between 1 and 100.");
        }
        if (!(["priority", "newest", "sla"] as const).includes(query.sort)) {
          throw new RangeError("sort must be priority, newest, or sla.");
        }
        const parameters: unknown[] = [query.organizationId];
        const addParameter = (value: unknown): string => {
          parameters.push(value);
          return `$${parameters.length}`;
        };
        const nowParameter = addParameter(referenceTime(options));
        const predicates = [
          "f.organization_id = $1",
          "f.entity_type = 'finding'",
          "c.organization_id = f.organization_id",
          "c.entity_type = 'company'",
          "c.entity_id = f.payload->>'companyId'",
        ];
        if (!query.includeVerified) {
          predicates.push("f.payload->>'state' <> 'Verified fixed'");
        }
        for (const [field, value] of [
          ["companyId", query.companyId],
          ["state", query.state],
          ["severity", query.severity],
          ["owner", query.owner],
        ] as const) {
          if (value !== undefined) {
            predicates.push(`f.payload->>'${field}' = ${addParameter(value)}`);
          }
        }
        if (query.search) {
          const searchParameter = addParameter(
            query.search.toLocaleLowerCase("en-US"),
          );
          predicates.push(`(
            strpos(lower(f.payload->>'findingKey'), ${searchParameter}) > 0 OR
            strpos(lower(f.payload->>'title'), ${searchParameter}) > 0 OR
            strpos(lower(c.payload->>'name'), ${searchParameter}) > 0 OR
            strpos(lower(f.payload->>'source'), ${searchParameter}) > 0 OR
            strpos(lower(f.payload->>'owner'), ${searchParameter}) > 0 OR
            strpos(lower(f.payload->>'assetName'), ${searchParameter}) > 0
          )`);
        }
        const slaExpression = `(f.payload->>'state' <> 'Verified fixed' AND
          (f.payload->>'slaDueAt')::timestamptz < ${nowParameter}::timestamptz)`;
        const priorityExpression = `CASE
          WHEN f.payload->>'state' = 'Verification failed' THEN 1
          WHEN f.payload->>'state' = 'Awaiting verification'
            AND f.payload->>'severity' = 'Critical' THEN 2
          WHEN f.payload->>'state' = 'Verified fixed' THEN 6
          WHEN ${slaExpression} THEN 3
          WHEN f.payload->>'severity' IN ('Critical', 'High')
            AND f.payload->>'state' IN ('Needs remediation', 'Remediating') THEN 4
          ELSE 5 END`;
        const baseSql = `FROM remedence_entities f
          JOIN remedence_entities c ON c.organization_id = f.organization_id
            AND c.entity_type = 'company'
            AND c.entity_id = f.payload->>'companyId'
          WHERE ${predicates.join(" AND ")}`;
        const countParameters = [...parameters];
        const countPromise = database.query<{ total: string }>(
          `SELECT count(*)::text AS total ${baseSql}
           AND ${nowParameter}::timestamptz IS NOT NULL`,
          countParameters,
        );

        const cursorPredicates: string[] = [];
        const order =
          query.sort === "priority"
            ? "priority_bucket ASC, sla_due_at ASC, detected_at ASC, finding_key ASC"
            : query.sort === "newest"
              ? "detected_at DESC, finding_key ASC"
              : "sla_breached DESC, sla_due_at ASC, finding_key ASC";
        if (query.cursor) {
          const expectedLength = query.sort === "priority" ? 4 : 3;
          const values = decodeCursor(
            query.cursor,
            `findings:${query.sort}`,
            query.sort === "newest" ? 2 : expectedLength,
          );
          const cursorParameters = values.map(addParameter);
          if (query.sort === "priority") {
            const [bucket, dueAt, detectedAt, findingKey] = cursorParameters;
            cursorPredicates.push(`(priority_bucket > ${bucket} OR
              (priority_bucket = ${bucket} AND sla_due_at > ${dueAt}) OR
              (priority_bucket = ${bucket} AND sla_due_at = ${dueAt} AND detected_at > ${detectedAt}) OR
              (priority_bucket = ${bucket} AND sla_due_at = ${dueAt} AND detected_at = ${detectedAt}
                AND finding_key > ${findingKey}))`);
          } else if (query.sort === "newest") {
            const [detectedAt, findingKey] = cursorParameters;
            cursorPredicates.push(`(detected_at < ${detectedAt} OR
              (detected_at = ${detectedAt} AND finding_key > ${findingKey}))`);
          } else {
            const [breached, dueAt, findingKey] = cursorParameters;
            cursorPredicates.push(`(sla_breached < (${breached}::int = 1) OR
              (sla_breached = (${breached}::int = 1) AND sla_due_at > ${dueAt}) OR
              (sla_breached = (${breached}::int = 1) AND sla_due_at = ${dueAt}
                AND finding_key > ${findingKey}))`);
          }
        }
        const limitParameter = addParameter(query.pageSize + 1);
        const pagePromise = database.query<{
          finding: Finding;
          company: Company;
        }>(
          `WITH candidates AS (
             SELECT f.payload AS finding, c.payload AS company,
               ${slaExpression} AS sla_breached,
               ${priorityExpression} AS priority_bucket,
               f.payload->>'slaDueAt' AS sla_due_at,
               f.payload->>'detectedAt' AS detected_at,
               f.payload->>'findingKey' AS finding_key
             ${baseSql}
           )
           SELECT finding, company FROM candidates
           ${cursorPredicates.length ? `WHERE ${cursorPredicates.join(" AND ")}` : ""}
           ORDER BY ${order}
           LIMIT ${limitParameter}`,
          parameters,
        );
        const [countResult, pageResult] = await Promise.all([
          countPromise,
          pagePromise,
        ]);
        const page = pageResult.rows.map(({ finding, company }) =>
          dashboardFinding(finding, company, referenceTime(options)),
        );
        const hasNext = page.length > query.pageSize;
        const items = hasNext ? page.slice(0, query.pageSize) : page;
        const last = items.at(-1);
        return {
          items,
          pageSize: query.pageSize,
          total: Number(countResult.rows[0]?.total ?? 0),
          nextCursor:
            hasNext && last
              ? encodeCursor(
                  `findings:${query.sort}`,
                  cursorValues(query.sort, last),
                )
              : null,
        };
      },
      async getDetail(
        organizationId,
        findingKey,
      ): Promise<FindingDetail | undefined> {
        const finding = await repositories.findings.findByKey(
          organizationId,
          findingKey,
        );
        if (!finding) return undefined;
        const [company, remediations, runs, evidence, auditPage] =
          await Promise.all([
            repositories.companies.getById(organizationId, finding.companyId),
            repositories.remediations.listByFinding(organizationId, finding.id),
            repositories.verifications.listByFinding(
              organizationId,
              finding.id,
            ),
            repositories.evidence.list({
              organizationId,
              findingId: finding.id,
              pageSize: 100,
            }),
            repositories.auditEvents.list({ organizationId, pageSize: 10_000 }),
          ]);
        if (!company) throw new Error("Finding company is not readable.");
        const verifications = await Promise.all(
          runs.map(async (run) => ({
            ...run,
            checks: await repositories.verifications.listChecks(
              organizationId,
              run.id,
            ),
          })),
        );
        const relatedIds = new Set([
          finding.id,
          ...remediations.map((item) => item.id),
          ...runs.map((item) => item.id),
          ...evidence.items.map((item) => item.id),
        ]);
        return {
          finding,
          company,
          remediations,
          verifications,
          evidence: evidence.items.toReversed(),
          auditEvents: auditPage.items.filter((event) =>
            relatedIds.has(event.entityId),
          ),
        };
      },
      insert: (finding) =>
        insertEntity(
          database,
          "finding",
          finding,
          finding.createdAt,
          finding.updatedAt,
        ),
      async updateState(organizationId, id, expectedState, state, updatedAt) {
        const result = await database.query(
          `UPDATE remedence_entities
           SET payload = jsonb_set(
                 jsonb_set(
                   jsonb_set(payload, '{state}', to_jsonb($4::text)),
                   '{updatedAt}', to_jsonb($5::text)
                 ),
                 '{version}', to_jsonb(((payload->>'version')::integer + 1))
               ),
               updated_at = $5::timestamptz
           WHERE organization_id = $1 AND entity_type = 'finding'
             AND entity_id = $2 AND payload->>'state' = $3`,
          [organizationId, id, expectedState, state, updatedAt],
        );
        if (result.rowCount !== 1) {
          throw new DomainError(
            "CONCURRENT_STATE_CHANGE",
            409,
            "Finding state changed concurrently or no longer exists.",
          );
        }
      },
    },
    remediations: {
      getById: (organizationId, id) =>
        getEntity<Remediation>(database, organizationId, "remediation", id),
      listByFinding: (organizationId, findingId) =>
        listEntities<Remediation>(
          database,
          organizationId,
          "remediation",
          "AND payload->>'findingId' = $3",
          [findingId],
        ),
      insert: (item) =>
        insertEntity(
          database,
          "remediation",
          item,
          item.createdAt,
          item.updatedAt,
        ),
      async complete(
        organizationId,
        id,
        summary,
        reference,
        remediatorPrincipalId,
        completedAt,
        updatedAt,
      ) {
        const current = await getEntity<Remediation>(
          database,
          organizationId,
          "remediation",
          id,
        );
        if (!current || current.status !== "In progress") {
          throw new DomainError(
            "CONCURRENT_STATE_CHANGE",
            409,
            "Remediation changed concurrently or no longer exists.",
          );
        }
        const next: Remediation = {
          ...current,
          status: "Completed",
          summary,
          reference,
          remediatorPrincipalId,
          completedAt,
          updatedAt,
          version: current.version + 1,
        };
        const result = await database.query(
          `UPDATE remedence_entities SET payload = $5::jsonb, updated_at = $6
           WHERE organization_id = $1 AND entity_type = 'remediation'
             AND entity_id = $2 AND payload->>'status' = $3
             AND (payload->>'version')::integer = $4`,
          [
            organizationId,
            id,
            "In progress",
            current.version,
            JSON.stringify(next),
            updatedAt,
          ],
        );
        if (result.rowCount !== 1) {
          throw new DomainError(
            "CONCURRENT_STATE_CHANGE",
            409,
            "Remediation changed concurrently.",
          );
        }
      },
    },
    verifications: {
      getById: (organizationId, id) =>
        getEntity<VerificationRun>(
          database,
          organizationId,
          "verification",
          id,
        ),
      listByFinding: (organizationId, findingId) =>
        listEntities<VerificationRun>(
          database,
          organizationId,
          "verification",
          "AND payload->>'findingId' = $3",
          [findingId],
        ),
      insert: (run) =>
        insertEntity(
          database,
          "verification",
          run,
          run.createdAt,
          run.createdAt,
        ),
      insertCheck: (check) =>
        insertEntity(
          database,
          "verification-check",
          check,
          check.createdAt,
          check.createdAt,
        ),
      async recordCheck(
        organizationId,
        verificationId,
        sequence,
        name,
        status,
        message,
      ) {
        const result = await database.query(
          `UPDATE remedence_entities
           SET payload = jsonb_set(
             jsonb_set(payload, '{status}', to_jsonb($5::text)),
             '{message}', to_jsonb($6::text)
           )
           WHERE organization_id = $1 AND entity_type = 'verification-check'
             AND payload->>'verificationId' = $2
             AND (payload->>'sequence')::integer = $3
             AND payload->>'name' = $4 AND payload->>'status' = 'Pending'`,
          [organizationId, verificationId, sequence, name, status, message],
        );
        if (result.rowCount !== 1) {
          throw new DomainError(
            "CONCURRENT_STATE_CHANGE",
            409,
            "Verification check changed concurrently.",
          );
        }
      },
      listChecks: (organizationId, verificationId) =>
        listEntities<VerificationCheck>(
          database,
          organizationId,
          "verification-check",
          "AND payload->>'verificationId' = $3",
          [verificationId],
          "(payload->>'sequence')::integer ASC, entity_id ASC",
        ),
      async complete(organizationId, id, status, summary, completedAt) {
        const current = await getEntity<VerificationRun>(
          database,
          organizationId,
          "verification",
          id,
        );
        if (!current || current.status !== "Running") {
          throw new DomainError(
            "CONCURRENT_STATE_CHANGE",
            409,
            "Verification changed concurrently.",
          );
        }
        const next = {
          ...current,
          status,
          resultSummary: summary,
          completedAt,
          version: current.version + 1,
        };
        const result = await database.query(
          `UPDATE remedence_entities SET payload = $4::jsonb, updated_at = $5
           WHERE organization_id = $1 AND entity_type = 'verification'
             AND entity_id = $2 AND payload->>'status' = $3`,
          [organizationId, id, "Running", JSON.stringify(next), completedAt],
        );
        if (result.rowCount !== 1) {
          throw new DomainError(
            "CONCURRENT_STATE_CHANGE",
            409,
            "Verification changed concurrently.",
          );
        }
      },
    },
    evidence: {
      getById: (organizationId, id) =>
        getEntity<EvidenceItem>(database, organizationId, "evidence", id),
      async list(query): Promise<CursorPage<EvidenceItem>> {
        if (
          !Number.isSafeInteger(query.pageSize) ||
          query.pageSize < 1 ||
          query.pageSize > 100
        ) {
          throw new RangeError("pageSize must be between 1 and 100.");
        }
        let rows = await listEntities<EvidenceItem>(
          database,
          query.organizationId,
          "evidence",
          "",
          [],
          "created_at DESC, entity_id DESC",
        );
        rows = rows.filter(
          (item) =>
            (query.findingId === undefined ||
              item.findingId === query.findingId) &&
            (query.verificationId === undefined ||
              item.verificationId === query.verificationId) &&
            (query.locked === undefined ||
              Boolean(item.lockedAt) === query.locked),
        );
        const total = rows.length;
        if (query.cursor) {
          const [createdAt, id] = decodeCursor(query.cursor, "evidence", 2);
          if (typeof createdAt !== "string" || typeof id !== "string") {
            throw new RangeError("cursor is invalid for evidence.");
          }
          rows = rows.filter(
            (item) =>
              item.createdAt < createdAt ||
              (item.createdAt === createdAt && item.id < id),
          );
        }
        const page = rows.slice(0, query.pageSize + 1);
        const hasNext = page.length > query.pageSize;
        const items = hasNext ? page.slice(0, query.pageSize) : page;
        const last = items.at(-1);
        return {
          items,
          pageSize: query.pageSize,
          total,
          nextCursor:
            hasNext && last
              ? encodeCursor("evidence", [last.createdAt, last.id])
              : null,
        };
      },
      insert: (item) =>
        insertEntity(
          database,
          "evidence",
          item,
          item.createdAt,
          item.createdAt,
        ),
      getArtifact: (organizationId, id) =>
        getEntity<EvidenceArtifact>(
          database,
          organizationId,
          "evidence-artifact",
          id,
        ),
      insertArtifact: (artifact) =>
        insertEntity(
          database,
          "evidence-artifact",
          artifact,
          artifact.createdAt,
          artifact.createdAt,
        ),
      async adoptArtifact(organizationId, artifactId, adoptedAt) {
        const result = await database.query(
          `UPDATE remedence_entities
           SET payload = jsonb_set(payload, '{adoptedAt}', to_jsonb($3::text)),
               updated_at = $3::timestamptz
           WHERE organization_id = $1 AND entity_type = 'evidence-artifact'
             AND entity_id = $2 AND payload->>'scanStatus' = 'Clean'
             AND payload->'adoptedAt' = 'null'::jsonb`,
          [organizationId, artifactId, adoptedAt],
        );
        return result.rowCount === 1;
      },
    },
    reports: {
      getById: (organizationId, id) =>
        getEntity<Report>(database, organizationId, "report", id),
      listByCompany: (organizationId, companyId) =>
        listEntities<Report>(
          database,
          organizationId,
          "report",
          "AND payload->>'companyId' = $3",
          [companyId],
          "payload->>'generatedAt' DESC, entity_id DESC",
        ),
      insert: (report) =>
        insertEntity(
          database,
          "report",
          report,
          report.createdAt,
          report.generatedAt,
        ),
    },
    auditEvents: {
      async append(event) {
        await database.query(
          `INSERT INTO remedence_audit_events
             (organization_id, actor_type, actor_id, action, entity_type,
              entity_id, details, occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
          [
            event.organizationId,
            event.actorType,
            event.actorId,
            event.action,
            event.entityType,
            event.entityId,
            JSON.stringify(event.details),
            event.occurredAt,
          ],
        );
      },
      async list(query): Promise<CursorPage<AuditEvent>> {
        if (!Number.isSafeInteger(query.pageSize) || query.pageSize < 1) {
          throw new RangeError("pageSize must be a positive integer.");
        }
        const filters = ["organization_id = $1"];
        const values: unknown[] = [query.organizationId];
        const add = (sql: string, value: unknown) => {
          values.push(value);
          filters.push(sql.replace("?", `$${values.length}`));
        };
        if (query.entityType !== undefined)
          add("entity_type = ?", query.entityType);
        if (query.entityId !== undefined) add("entity_id = ?", query.entityId);
        if (query.from !== undefined) add("occurred_at >= ?", query.from);
        if (query.to !== undefined) add("occurred_at <= ?", query.to);
        const collectionFilters = [...filters];
        const collectionValues = [...values];
        if (query.cursor) {
          const [id] = decodeCursor(query.cursor, "audit-events", 1);
          if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
            throw new RangeError("cursor is invalid for audit events.");
          }
          add("id > ?", id);
        }
        values.push(query.pageSize + 1);
        const [count, page] = await Promise.all([
          database.query<{ total: number }>(
            `SELECT COUNT(*)::integer AS total FROM remedence_audit_events WHERE ${collectionFilters.join(" AND ")}`,
            collectionValues,
          ),
          database.query<{
            id: string;
            organization_id: string;
            actor_type: string;
            actor_id: string;
            action: string;
            entity_type: string;
            entity_id: string;
            details: Record<string, unknown>;
            occurred_at: Date;
          }>(
            `SELECT * FROM remedence_audit_events WHERE ${filters.join(" AND ")}
             ORDER BY id ASC LIMIT $${values.length}`,
            values,
          ),
        ]);
        const mapped = page.rows.map((row): AuditEvent => ({
          id: Number(row.id),
          organizationId: row.organization_id,
          actorType: row.actor_type,
          actorId: row.actor_id,
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          details: row.details,
          occurredAt: row.occurred_at.toISOString(),
        }));
        const hasNext = mapped.length > query.pageSize;
        const items = hasNext ? mapped.slice(0, query.pageSize) : mapped;
        const last = items.at(-1);
        return {
          items,
          pageSize: query.pageSize,
          total: count.rows[0]?.total ?? 0,
          nextCursor:
            hasNext && last?.id
              ? encodeCursor("audit-events", [last.id])
              : null,
        };
      },
    },
  };
  return repositories;
}

export function createPostgresUnitOfWork(
  database: PostgresDatabase,
  options: RepositorySetOptions,
): UnitOfWork {
  return {
    run: (operation) =>
      database.transaction(() =>
        operation(createPostgresRepositorySet(database, options)),
      ),
  };
}
