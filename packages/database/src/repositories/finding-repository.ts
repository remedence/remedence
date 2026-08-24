import {
  DomainError,
  type Company,
  type DashboardFinding,
  type Finding,
  type FindingDetail,
  type FindingQuery,
  type FindingRepository,
  type Page,
} from "@remedence/core";
import { getDatabaseConnection, type RemedenceDatabase } from "../database.js";
import {
  mapAuditEventRow,
  mapCompanyRow,
  mapDashboardFindingRow,
  mapEvidenceItemRow,
  mapFindingRow,
  mapRemediationRow,
  mapVerificationCheckRow,
  mapVerificationRunRow,
} from "../rows.js";

const FINDING_COLUMNS = `
  f.id,
  f.organization_id,
  f.company_id,
  f.finding_key,
  f.title,
  f.description,
  f.source,
  f.severity,
  f.state,
  f.owner,
  f.asset_name,
  f.detected_at,
  f.sla_due_at,
  f.created_at,
  f.updated_at,
  f.version
`;

const COMPANY_COLUMNS = `
  id,
  organization_id,
  name,
  risk_score,
  risk_level,
  created_at,
  updated_at,
  version
`;

const REMEDIATION_COLUMNS = `
  organization_id,
  id,
  finding_id,
  status,
  summary,
  reference,
  owner,
  remediator_principal_id,
  started_at,
  completed_at,
  created_at,
  updated_at,
  version
`;

const VERIFICATION_COLUMNS = `
  organization_id,
  id,
  finding_id,
  remediation_id,
  status,
  method,
  worker_name,
  verifier_principal_id,
  credential_type,
  execution_source,
  source_revision,
  patch_digest,
  scope,
  result_summary,
  started_at,
  completed_at,
  created_at,
  version
`;

const VERIFICATION_CHECK_COLUMNS = `
  organization_id,
  id,
  verification_id,
  sequence,
  name,
  status,
  message,
  created_at
`;

const EVIDENCE_COLUMNS = `
  organization_id,
  id,
  finding_id,
  verification_id,
  kind,
  label,
  source_reference,
  content_hash,
  artifact_id,
  manifest_hash,
  manifest_signature,
  attested_by,
  metadata_json,
  created_at,
  locked_at
`;

const AUDIT_EVENT_COLUMNS = `
  id,
  organization_id,
  actor_type,
  actor_id,
  action,
  entity_type,
  entity_id,
  details_json,
  occurred_at
`;

const SORT_SQL = {
  priority:
    "priority_bucket ASC, sla_due_at ASC, detected_at ASC, finding_key ASC",
  newest: "detected_at DESC, finding_key ASC",
  sla: "sla_breached DESC, sla_due_at ASC, finding_key ASC",
} as const;

export interface FindingRepositoryOptions {
  referenceTime: string | (() => string);
}

function requirePositiveInteger(
  value: number,
  name: string,
  maximum?: number,
): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  if (maximum !== undefined && value > maximum) {
    throw new RangeError(`${name} must be at most ${maximum}.`);
  }
}

function requireCanonicalTimestamp(value: string, name: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new TypeError(`${name} must be a canonical UTC ISO 8601 timestamp.`);
  }
}

function resolveReferenceTime(options: FindingRepositoryOptions): string {
  const referenceTime =
    typeof options.referenceTime === "function"
      ? options.referenceTime()
      : options.referenceTime;
  requireCanonicalTimestamp(referenceTime, "referenceTime");
  return referenceTime;
}

function readTotal(row: unknown): number {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new TypeError("Finding count query did not return a row.");
  }
  const total = (row as Record<string, unknown>).total;
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) {
    throw new TypeError("Finding count query returned an invalid total.");
  }
  return total;
}

function requireCompany(row: unknown): Company {
  if (!row) {
    throw new Error("Finding references a company that is not readable.");
  }
  return mapCompanyRow(row);
}

export function createFindingRepository(
  database: RemedenceDatabase,
  options: FindingRepositoryOptions,
): FindingRepository {
  if (typeof options.referenceTime === "string") {
    requireCanonicalTimestamp(options.referenceTime, "referenceTime");
  }
  const connection = getDatabaseConnection(database);

  const getByIdStatement = connection.prepare(
    `SELECT ${FINDING_COLUMNS}
     FROM findings AS f
     WHERE f.organization_id = ? AND f.id = ?`,
  );
  const findByKeyStatement = connection.prepare(
    `SELECT ${FINDING_COLUMNS}
     FROM findings AS f
     WHERE f.organization_id = ? AND f.finding_key = ? COLLATE NOCASE`,
  );
  const companyByIdStatement = connection.prepare(
    `SELECT ${COMPANY_COLUMNS}
     FROM companies
     WHERE organization_id = ? AND id = ?`,
  );
  const remediationsByFindingStatement = connection.prepare(
    `SELECT ${REMEDIATION_COLUMNS}
     FROM remediations
     WHERE organization_id = ? AND finding_id = ?
     ORDER BY created_at ASC, id ASC`,
  );
  const verificationsByFindingStatement = connection.prepare(
    `SELECT ${VERIFICATION_COLUMNS}
     FROM verification_runs
     WHERE organization_id = ? AND finding_id = ?
     ORDER BY created_at ASC, id ASC`,
  );
  const checksByVerificationStatement = connection.prepare(
    `SELECT ${VERIFICATION_CHECK_COLUMNS}
     FROM verification_checks
     WHERE organization_id = ? AND verification_id = ?
     ORDER BY sequence ASC, id ASC`,
  );
  const evidenceByFindingStatement = connection.prepare(
    `SELECT ${EVIDENCE_COLUMNS}
     FROM evidence_items
     WHERE organization_id = ? AND finding_id = ?
     ORDER BY created_at ASC, id ASC`,
  );
  const auditByFindingStatement = connection.prepare(
    `SELECT ${AUDIT_EVENT_COLUMNS}
     FROM audit_events AS ae
     WHERE ae.organization_id = ?
       AND (
         (ae.entity_type = 'finding' AND ae.entity_id = ?)
         OR (
           ae.entity_type = 'remediation'
           AND ae.entity_id IN (
             SELECT r.id FROM remediations AS r
             WHERE r.organization_id = ae.organization_id AND r.finding_id = ?
           )
         )
         OR (
           ae.entity_type = 'verification'
           AND ae.entity_id IN (
             SELECT vr.id FROM verification_runs AS vr
             WHERE vr.organization_id = ae.organization_id AND vr.finding_id = ?
           )
         )
         OR (
           ae.entity_type = 'evidence'
           AND ae.entity_id IN (
             SELECT ei.id FROM evidence_items AS ei
             WHERE ei.organization_id = ae.organization_id AND ei.finding_id = ?
           )
         )
       )
     ORDER BY ae.id ASC`,
  );
  const insertStatement = connection.prepare(
    `INSERT INTO findings (
       id, organization_id, company_id, finding_key, title, description,
       source, severity, state, owner, asset_name, detected_at, sla_due_at,
       created_at, updated_at, version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateStateStatement = connection.prepare(
    `UPDATE findings
     SET state = ?, updated_at = ?, version = version + 1
     WHERE organization_id = ? AND id = ? AND state = ?`,
  );

  return {
    getById(organizationId: string, findingId: string): Finding | undefined {
      const row = getByIdStatement.get(organizationId, findingId);
      return row ? mapFindingRow(row) : undefined;
    },

    findByKey(organizationId: string, findingKey: string): Finding | undefined {
      const row = findByKeyStatement.get(organizationId, findingKey);
      return row ? mapFindingRow(row) : undefined;
    },

    list(query: FindingQuery): Page<DashboardFinding> {
      requirePositiveInteger(query.page, "page");
      requirePositiveInteger(query.pageSize, "pageSize", 100);
      const orderBy = (SORT_SQL as Record<string, string>)[query.sort];
      if (orderBy === undefined) {
        throw new RangeError("sort must be priority, newest, or sla.");
      }

      const filters = ["f.organization_id = ?"];
      const parameters: string[] = [query.organizationId];

      if (!query.includeVerified) {
        filters.push("f.state <> 'Verified fixed'");
      }
      if (query.companyId !== undefined) {
        filters.push("f.company_id = ?");
        parameters.push(query.companyId);
      }
      if (query.state !== undefined) {
        filters.push("f.state = ?");
        parameters.push(query.state);
      }
      if (query.severity !== undefined) {
        filters.push("f.severity = ?");
        parameters.push(query.severity);
      }
      if (query.owner !== undefined) {
        filters.push("f.owner = ?");
        parameters.push(query.owner);
      }
      if (query.search !== undefined && query.search.length > 0) {
        filters.push(`(
          instr(lower(f.finding_key), lower(?)) > 0
          OR instr(lower(f.title), lower(?)) > 0
          OR instr(lower(c.name), lower(?)) > 0
          OR instr(lower(f.source), lower(?)) > 0
          OR instr(lower(f.owner), lower(?)) > 0
          OR instr(lower(f.asset_name), lower(?)) > 0
        )`);
        parameters.push(
          query.search,
          query.search,
          query.search,
          query.search,
          query.search,
          query.search,
        );
      }

      const whereSql = filters.join(" AND ");
      const total = readTotal(
        connection
          .prepare(
            `SELECT COUNT(f.id) AS total
             FROM findings AS f
             JOIN companies AS c
               ON c.organization_id = f.organization_id AND c.id = f.company_id
             WHERE ${whereSql}`,
          )
          .get(...parameters),
      );
      const referenceTime = resolveReferenceTime(options);
      const offset = (query.page - 1) * query.pageSize;
      const items = connection
        .prepare(
          `SELECT
             ${FINDING_COLUMNS},
             c.name AS company_name,
             CASE
               WHEN f.state <> 'Verified fixed' AND f.sla_due_at < ? THEN 1
               ELSE 0
             END AS sla_breached,
             CASE
               WHEN f.state = 'Verification failed' THEN 1
               WHEN f.state = 'Awaiting verification' AND f.severity = 'Critical' THEN 2
               WHEN f.state = 'Verified fixed' THEN 6
               WHEN f.sla_due_at < ? THEN 3
               WHEN f.severity IN ('Critical', 'High')
                 AND f.state IN ('Needs remediation', 'Remediating') THEN 4
               ELSE 5
             END AS priority_bucket
           FROM findings AS f
           JOIN companies AS c
             ON c.organization_id = f.organization_id AND c.id = f.company_id
           WHERE ${whereSql}
           ORDER BY ${orderBy}
           LIMIT ? OFFSET ?`,
        )
        .all(
          referenceTime,
          referenceTime,
          ...parameters,
          query.pageSize,
          offset,
        )
        .map(mapDashboardFindingRow);

      return {
        items,
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    },

    getDetail(
      organizationId: string,
      findingKey: string,
    ): FindingDetail | undefined {
      const findingRow = findByKeyStatement.get(organizationId, findingKey);
      if (!findingRow) return undefined;

      const finding = mapFindingRow(findingRow);
      const company = requireCompany(
        companyByIdStatement.get(organizationId, finding.companyId),
      );
      const remediations = remediationsByFindingStatement
        .all(organizationId, finding.id)
        .map(mapRemediationRow);
      const verifications = verificationsByFindingStatement
        .all(organizationId, finding.id)
        .map(mapVerificationRunRow)
        .map((verification) => ({
          ...verification,
          checks: checksByVerificationStatement
            .all(organizationId, verification.id)
            .map(mapVerificationCheckRow),
        }));
      const evidence = evidenceByFindingStatement
        .all(organizationId, finding.id)
        .map(mapEvidenceItemRow);
      const auditEvents = auditByFindingStatement
        .all(organizationId, finding.id, finding.id, finding.id, finding.id)
        .map(mapAuditEventRow);

      return {
        finding,
        company,
        remediations,
        verifications,
        evidence,
        auditEvents,
      };
    },

    insert(finding: Finding): void {
      insertStatement.run(
        finding.id,
        finding.organizationId,
        finding.companyId,
        finding.findingKey,
        finding.title,
        finding.description,
        finding.source,
        finding.severity,
        finding.state,
        finding.owner,
        finding.assetName,
        finding.detectedAt,
        finding.slaDueAt,
        finding.createdAt,
        finding.updatedAt,
        finding.version,
      );
    },

    updateState(organizationId, id, expectedState, state, updatedAt): void {
      const result = updateStateStatement.run(
        state,
        updatedAt,
        organizationId,
        id,
        expectedState,
      );
      if (result.changes !== 1) {
        throw new DomainError(
          "CONCURRENT_STATE_CHANGE",
          409,
          "Finding state changed concurrently or the finding no longer exists.",
          { findingId: id },
        );
      }
    },
  };
}
